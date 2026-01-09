import { useState, useEffect, useRef } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { ethers } from 'ethers'

const HALLIDAY_API_KEY = import.meta.env.VITE_HALLIDAY_API_KEY

function Retry() {
  const { ready, authenticated, login, logout } = usePrivy()
  const { wallets } = useWallets()

  // State
  const [userAddress, setUserAddress] = useState('')
  const [screen, setScreen] = useState('selection') // 'selection' or 'signing'
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [erringPayments, setErringPayments] = useState([])
  const [supportedAssets, setSupportedAssets] = useState(null)
  const [supportedChains, setSupportedChains] = useState(null)

  // Signing screen state
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [selectedBalances, setSelectedBalances] = useState(null)
  const [withdrawalOptions, setWithdrawalOptions] = useState([])

  // Get wallet, may be Privy embedded or other like EIP-1193
  // const wallet = wallets.find(w => w.walletClientType === 'privy')
  const wallet = wallets[0]

  // Status polling refs
  const statusIntervalRef = useRef(null)

  // API calls
  async function getSupportedAssets() {
    try {
      const res = await fetch('https://v2.prod.halliday.xyz/assets', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
          'Content-Type': 'application/json'
        }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      return data
    } catch (e) {
      console.error('getSupportedAssets error', e)
    }
  }

  async function getSupportedChains() {
    try {
      const res = await fetch('https://v2.prod.halliday.xyz/chains', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
          'Content-Type': 'application/json'
        }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      return data
    } catch (e) {
      console.error('getSupportedChains error', e)
    }
  }

  async function getWalletPaymentHistory(address, paginationKey) {
    const params = new URLSearchParams({
      category: 'ALL',
      owner_address: address,
      ...(paginationKey && { pagination_key: paginationKey })
    })

    const res = await fetch(`https://v2.prod.halliday.xyz/payments/history?${params}&limit=500`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
        'Content-Type': 'application/json'
      }
    })

    return res.json()
  }

  async function getProcessingAddressBalances(paymentId) {
    try {
      const res = await fetch('https://v2.prod.halliday.xyz/payments/balances', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ payment_id: paymentId })
      })
      return res.json()
    } catch (e) {
      console.error('getProcessingAddressBalances error', e)
    }
  }

  async function getTypedData(withdrawToAddress, paymentId, token, amount) {
    try {
      const res = await fetch('https://v2.prod.halliday.xyz/payments/withdraw', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payment_id: paymentId,
          token_amounts: [{ token, amount }],
          recipient_address: withdrawToAddress,
        })
      })
      return res.json()
    } catch (e) {
      console.error('getTypedData error', e)
    }
  }

  async function confirmWithdrawal(withdrawToAddress, paymentId, token, amount, signature) {
    try {
      const res = await fetch('https://v2.prod.halliday.xyz/payments/withdraw/confirm', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payment_id: paymentId,
          token_amounts: [{ token, amount }],
          recipient_address: withdrawToAddress,
          owner_signature: signature
        })
      })
      const data = await res.json()
      return data.transaction_hash
    } catch (e) {
      console.error('confirmWithdrawal error', e)
    }
  }

  async function getQuote(inputAmount, inputAsset, outputAsset, parentPaymentId) {
    const res = await fetch('https://v2.prod.halliday.xyz/payments/quotes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        request: {
          kind: 'FIXED_INPUT',
          fixed_input_amount: { asset: inputAsset, amount: inputAmount },
          output_asset: outputAsset
        },
        price_currency: 'USD',
        parent_payment_id: parentPaymentId,
      })
    })

    const data = await res.json()
    console.log('getQuote', data)
    return data
  }

  async function acceptQuote(paymentId, stateToken) {
    try {
      const requestBody = {
        payment_id: paymentId,
        state_token: stateToken,
        owner_address: userAddress,
        destination_address: userAddress
      }

      const res = await fetch('https://v2.prod.halliday.xyz/payments/confirm', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      console.log('acceptQuote', data)
      return data
    } catch (e) {
      console.error('acceptQuote error', e)
    }
  }

  async function getStatus(paymentId) {
    try {
      const res = await fetch(`https://v2.prod.halliday.xyz/payments?payment_id=${paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
          'Content-Type': 'application/json'
        }
      })

      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      console.log('getStatus', data)
      return data
    } catch (e) {
      console.error('getStatus error', e)
    }
  }

  // Fetch erring payments
  async function showErringPayments(walletAddress, assets) {
    setIsLoadingHistory(true)
    setErringPayments([])

    // // Fetch the full payment history using pagination
    // const payments = []
    // let paginationKey
    // do {
    //   const history = await getWalletPaymentHistory(walletAddress, paginationKey)
    //   if (history.next_pagination_key) {
    //     paginationKey = history.next_pagination_key
    //   } else {
    //     paginationKey = undefined
    //   }
    //   payments.push(...history.payment_statuses)
    // } while (paginationKey)

    // Get first X payments, no pagination of API responses
    const numPaymentsToFetch = 15
    const history = await getWalletPaymentHistory(walletAddress)
    const payments = history.payment_statuses.slice(0, numPaymentsToFetch)

    const erring = []

    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i]

      if (payment.status === 'COMPLETE') continue

      const balances = await getProcessingAddressBalances(payment.payment_id)
      const amount = balances.balance_results.reduce((sum, item) => sum + +item.value.amount, 0)

      if (amount === 0) continue

      const type = payment.quoted.route[0].type === 'USER_FUND' ? 'Swap' : 'Onramp'
      const input = type === 'Onramp'
        ? payment.quoted.route[0].net_effect.consume[0].resource.asset.toUpperCase()
        : assets[payment.quoted.route[0].net_effect.consume[0].resource.asset]?.symbol || 'Unknown'
      const outputAsset = payment.quoted.output_amount.asset
      const output = assets[payment.quoted.output_amount.asset]?.symbol || 'Unknown'
      const onramp = payment.quoted.onramp
      const provider = onramp ? onramp[0].toUpperCase() + onramp.slice(1) : 'Halliday'
      const time = new Date(payment.created_at).toLocaleString()
      const status = payment.status

      erring.push({
        paymentId: payment.payment_id,
        payment,
        balances,
        type,
        status,
        input,
        output,
        outputAsset,
        provider,
        amount,
        time
      })
    }

    setErringPayments(erring)
    setIsLoadingHistory(false)
  }

  // Handle retry button click
  async function handleRetryClick(paymentInfo, balances) {
    console.log('withdraw: id', paymentInfo.paymentId, 'payment', paymentInfo.payment, 'balances', balances)
    setSelectedPayment(paymentInfo)
    setSelectedBalances(balances)

    // Build withdrawal options
    const options = []
    for (let i = 0; i < balances.balance_results.length; i++) {
      const balance = balances.balance_results[i]
      const _token = balance.token
      const _amount = +balance.value.amount

      if (_amount === 0) continue

      const quoteResult = await getQuote(balance.value.amount, _token, paymentInfo.outputAsset, paymentInfo.paymentId)

      if (quoteResult.quotes.length === 0) {
        alert('Retry not possible. Try withdrawal.')
        continue
      }

      const fees = quoteResult.quotes[0].fees.total_fees
      const outputAmount = quoteResult.quotes[0].output_amount.amount
      const newPaymentId = quoteResult.quotes[0].payment_id
      const newStateToken = quoteResult.state_token

      options.push({
        balance,
        fees,
        outputAmount,
        newPaymentId,
        newStateToken,
        status: paymentInfo.status,
        isLoading: false,
        txHash: null,
        txExplorer: null
      })
    }

    setWithdrawalOptions(options)
    setScreen('signing')
  }

  // Handle sign & submit retry
  async function handleSignRetry(optionIndex) {
    const option = withdrawalOptions[optionIndex]

    // Update loading state
    setWithdrawalOptions(prev => prev.map((opt, i) =>
      i === optionIndex ? { ...opt, isLoading: true } : opt
    ))

    try {
      // Accept the retry quote
      const acceptQuoteRequest = await acceptQuote(option.newPaymentId, option.newStateToken)

      setWithdrawalOptions(prev => prev.map((opt, i) =>
        i === optionIndex ? { ...opt, status: acceptQuoteRequest.status + '...' } : opt
      ))

      // Fetch the retry signature data from the API
      const withdrawToAddress = acceptQuoteRequest.next_instruction.deposit_info[0].deposit_address
      const typedDataToSign = await getTypedData(
        withdrawToAddress,
        selectedPayment.paymentId,
        option.balance.token,
        option.balance.value.amount
      )
      const { domain, types, message } = JSON.parse(typedDataToSign.withdraw_authorization)
      delete types.EIP712Domain

      // Sign the retry transfer transaction using Privy wallet
      const ethereumProvider = await wallet.getEthereumProvider()
      const provider = new ethers.BrowserProvider(ethereumProvider)
      const signer = await provider.getSigner()
      const signature = await signer.signTypedData(domain, types, message)

      // Send signature to API to be posted onchain
      await confirmWithdrawal(
        withdrawToAddress,
        selectedPayment.paymentId,
        option.balance.token,
        option.balance.value.amount,
        signature
      )

      // Poll for status updates
      statusIntervalRef.current = setInterval(async () => {
        const _status = await getStatus(option.newPaymentId)

        setWithdrawalOptions(prev => prev.map((opt, i) =>
          i === optionIndex ? { ...opt, status: _status.status + '...' } : opt
        ))

        if (_status.status === 'COMPLETE') {
          const chain = _status.fulfilled.output_amount.asset.split(':')[0]
          const len = _status.fulfilled.route.length
          const txHash = _status.fulfilled.route[len - 1].transaction_hash
          const { explorer } = supportedChains[chain]

          setWithdrawalOptions(prev => prev.map((opt, i) =>
            i === optionIndex ? {
              ...opt,
              status: 'COMPLETE',
              isLoading: false,
              txHash,
              txExplorer: `${explorer}tx/${txHash}`
            } : opt
          ))

          clearInterval(statusIntervalRef.current)
        }
      }, 3000)
    } catch (e) {
      console.error('Error signing retry', e)
      setWithdrawalOptions(prev => prev.map((opt, i) =>
        i === optionIndex ? { ...opt, isLoading: false } : opt
      ))
    }
  }

  function handleBack() {
    clearInterval(statusIntervalRef.current)
    setScreen('selection')
    setSelectedPayment(null)
    setSelectedBalances(null)
    setWithdrawalOptions([])
  }

  // Effect: set address when authenticated
  useEffect(() => {
    if (authenticated && wallet?.address) {
      setUserAddress(wallet.address)
    } else {
      setUserAddress('')
      setErringPayments([])
    }
  }, [authenticated, wallet?.address])

  // Effect: fetch supported assets and chains on mount
  useEffect(() => {
    async function fetchSupportedData() {
      const [assets, chains] = await Promise.all([
        getSupportedAssets(),
        getSupportedChains()
      ])
      setSupportedAssets(assets)
      setSupportedChains(chains)
    }
    fetchSupportedData()
  }, [])

  // Effect: fetch erring payments when authenticated and assets loaded
  useEffect(() => {
    if (authenticated && userAddress && supportedAssets) {
      showErringPayments(userAddress, supportedAssets)
    }
  }, [authenticated, userAddress, supportedAssets])

  // Effect: alert if API key missing
  useEffect(() => {
    if (!HALLIDAY_API_KEY || HALLIDAY_API_KEY === '_your_api_key_here_') {
      alert('HALLIDAY_API_KEY is missing!')
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => clearInterval(statusIntervalRef.current)
  }, [])

  // Privy login section
  let privyLoginSection
  if (!ready) {
    privyLoginSection = <span className="address-label">Loading...</span>
  } else if (!authenticated) {
    privyLoginSection = (
      <button className="button enabled" onClick={login}>
        Sign in with Privy
      </button>
    )
  } else {
    privyLoginSection = (
      <p className="info-label">
        Connected wallet address to perform swap:
        <br />
        <span className="address-label">{wallet?.address || 'Loading...'}</span>
        <br />
        <button className="disconnect" onClick={logout}>Disconnect</button>
      </p>
    )
  }

  // Selection screen
  if (screen === 'selection') {
    return (
      <div id="selection-screen" className="container short">
        <h2 className="text-center">Retry Payment</h2>

        <div className="confirm-content">
          <div className="input-label text-center">
            Retry an incomplete payment using the payment's owner wallet.
          </div>
        </div>

        <div className="connect-wallet-container">
          {privyLoginSection}
        </div>

        <div className="transaction-history-container">
          {isLoadingHistory && <div className="loading-spinner"></div>}
          <ul id="transaction-history-items">
            {erringPayments.map((payment) => (
              <li key={payment.paymentId}>
                <div className="transaction-info">
                  <div className="transaction-row">
                    <span className="transaction-type">{payment.type} ({payment.status})</span>
                  </div>
                  <div className="transaction-route">{payment.input} -&gt; {payment.output} via {payment.provider}</div>
                  <div className="transaction-stuck">Stuck: {payment.amount}</div>
                  <div className="transaction-time">{payment.time}</div>
                </div>
                <button
                  className="small-button"
                  onClick={() => handleRetryClick(payment, payment.balances)}
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="powered-by">Powered by Halliday</div>
      </div>
    )
  }

  // Signing screen
  return (
    <div id="signing-screen" className="container">
      <h2 className="text-center">Retry</h2>
      <div id="back-button" className="back-button" onClick={handleBack}></div>
      <br />
      <span className="input-label text-center">
        No user gas tokens are spent when executing a retry payment.
      </span>

      {selectedPayment && (
        <div id="payment-information-container" className="payment-info-card">
          <span className="payment-type">{selectedPayment.type} ({selectedPayment.status})</span>
          <span className="payment-route">{selectedPayment.input} -&gt; {selectedPayment.output} via {selectedPayment.provider}</span>
          <span className="payment-stuck">Stuck: {selectedPayment.amount}</span>
          <span className="payment-time">{selectedPayment.time}</span>
        </div>
      )}

      <div id="withdrawal-options-container">
        {withdrawalOptions.map((option, index) => (
          <div key={index} className="withdrawal-option-card">
            <div className="token-name">Fees: ${option.fees}</div>
            <div className="token-amount">Output Amount: {option.outputAmount} {selectedPayment?.output}</div>
            <div className="token-amount">Status: {option.status}</div>
            <div className="transaction">
              {option.txExplorer && (
                <a target="_blank" rel="noreferrer" href={option.txExplorer}>See Transaction</a>
              )}
            </div>
            <button
              className={`small-button ${option.isLoading ? 'loading' : ''}`}
              onClick={() => handleSignRetry(index)}
              disabled={option.status === 'COMPLETE'}
            >
              Sign &amp; Submit Retry
            </button>
          </div>
        ))}
      </div>

      <br />
      <div className="powered-by sink">Powered by Halliday</div>
    </div>
  )
}

export default Retry