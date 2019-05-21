import Client from '@liquality/client'
import BitcoinJsLibSwapProvider from '@liquality/bitcoin-bitcoinjs-lib-swap-provider'
import BitcoreRpcProvider from '@liquality/bitcoin-bitcore-rpc-provider'
import BitcoinNetworks from '@liquality/bitcoin-networks'
import LNPayReq from 'bolt11'
import * as WebLN from 'webln'
import LN from './ln'
import { settings } from './settings'

async function getClients () {
  const bitcoin = new Client()
  bitcoin.addProvider(new BitcoreRpcProvider(settings.bitcoinUrl, settings.bitcoinUsername, settings.bitcoinPassword))
  bitcoin.addProvider(new BitcoinJsLibSwapProvider({ network: BitcoinNetworks[settings.bitcoinNetwork] }))

  // TODO: put into class that provides generic interface
  let ln, webln
  try {
    webln = await WebLN.requestProvider()
  }
  catch(err) {
    ln = new LN(settings.lndApiUrl, settings.macaroon)
  }

  return { bitcoin, ln, webln }
}

async function createOrder (value, recipientAddress) {
  const { bitcoin, ln } = await getClients()
  const refundAddress = (await bitcoin.wallet.getUnusedAddress()).address
  const expiration = parseInt(new Date().getTime() / 1000) + 43200 // 12 hours ahead
  const invoice = await ln.addInvoice(value.toString(), 'Submarinesssss')
  const invoiceData = LNPayReq.decode(invoice.payment_request)
  const preimageHash = invoiceData.tags.find(tag => tag.tagName === 'payment_hash').data
  const initiationTxHash = await bitcoin.swap.initiateSwap(value, recipientAddress, refundAddress, preimageHash, expiration)

  const payload = {
    tx: initiationTxHash,
    value,
    recipientAddress,
    refundAddress,
    preimageHash,
    expiration,
    invoice: invoice.payment_request
  }
  const order = encodeOrder(payload)
  return order
}

async function fillOrder (rawOrder) {
  const { bitcoin, ln } = await getClients()
  const order = decodeOrder(rawOrder)
  const payment = await ln.payInvoice(order.invoice)
  const preimageFromPayment = Buffer.from(payment.payment_preimage, 'base64').toString('hex')
  const claimTxHash = await bitcoin.swap.claimSwap(
    order.tx, order.recipientAddress, order.refundAddress, preimageFromPayment, order.expiration
  )
  return claimTxHash
}

function encodeOrder (order) {
  return Buffer.from(JSON.stringify(order)).toString('base64')
}

function decodeOrder (rawOrder) {
  const rawJson = Buffer.from(rawOrder, 'base64').toString()
  return rawJson.startsWith('{') ? JSON.parse(rawJson) : null
}

export { createOrder, fillOrder, decodeOrder }
