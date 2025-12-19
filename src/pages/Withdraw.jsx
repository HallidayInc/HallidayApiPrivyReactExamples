import { useState, useEffect } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { ethers } from 'ethers'

const HALLIDAY_API_KEY = import.meta.env.VITE_HALLIDAY_API_KEY

function Withdraw() {
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
  const [withdrawalOptions, setWithdrawalOptions] = useState([])

  // Get Privy embedded wallet
  const privyWallet = wallets.find(w => w.walletClientType === 'privy')

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

    const res = await fetch(`https://v2.prod.halliday.xyz/payments/history?${params}`, {
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

  // Fetch erring payments
  async function showErringPayments(address, assets) {
    setIsLoadingHistory(true)
    setErringPayments([])

    const numPaymentsToFetch = 15
    const history = await getWalletPaymentHistory(address)
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
        provider,
        amount,
        time
      })
    }

    setErringPayments(erring)
    setIsLoadingHistory(false)
  }

  // Handle withdraw button click
  function handleWithdrawClick(paymentInfo, balances) {
    console.log('withdraw: id', paymentInfo.paymentId, 'payment', paymentInfo.payment, 'balances', balances)
    setSelectedPayment(paymentInfo)

    // Build withdrawal options
    const options = balances.balance_results
      .filter(balance => +balance.value.amount > 0)
      .map(balance => ({
        balance,
        tokenName: supportedAssets[balance.token]?.name || 'Unknown Token',
        amount: +balance.value.amount,
        isLoading: false,
        isComplete: false,
        txHash: null,
        txExplorer: null
      }))

    setWithdrawalOptions(options)
    setScreen('signing')
  }

  // Handle sign & submit withdrawal
  async function handleSignWithdraw(optionIndex) {
    const option = withdrawalOptions[optionIndex]

    // Update loading state
    setWithdrawalOptions(prev => prev.map((opt, i) =>
      i === optionIndex ? { ...opt, isLoading: true } : opt
    ))

    try {
      // Fetch the withdraw signature data from the API
      const withdrawToAddress = userAddress
      const typedDataToSign = await getTypedData(
        withdrawToAddress,
        selectedPayment.paymentId,
        option.balance.token,
        option.balance.value.amount
      )
      const { domain, types, message } = JSON.parse(typedDataToSign.withdraw_authorization)
      delete types.EIP712Domain

      // Sign the withdraw transaction using Privy wallet
      const ethereumProvider = await privyWallet.getEthereumProvider()
      const provider = new ethers.BrowserProvider(ethereumProvider)
      const signer = await provider.getSigner()
      const signature = await signer.signTypedData(domain, types, message)

      // Send signature to API to be posted onchain
      const txHash = await confirmWithdrawal(
        withdrawToAddress,
        selectedPayment.paymentId,
        option.balance.token,
        option.balance.value.amount,
        signature
      )

      // Show the resulting withdraw transaction on the proper block explorer
      const chain = option.balance.token.split(':')[0]
      const { explorer } = supportedChains[chain]

      setWithdrawalOptions(prev => prev.map((opt, i) =>
        i === optionIndex ? {
          ...opt,
          isLoading: false,
          isComplete: true,
          txHash,
          txExplorer: `${explorer}tx/${txHash}`
        } : opt
      ))
    } catch (e) {
      console.error('Error signing withdrawal', e)
      setWithdrawalOptions(prev => prev.map((opt, i) =>
        i === optionIndex ? { ...opt, isLoading: false } : opt
      ))
    }
  }

  function handleBack() {
    setScreen('selection')
    setSelectedPayment(null)
    setWithdrawalOptions([])
  }

  // Effect: set address when authenticated
  useEffect(() => {
    if (authenticated && privyWallet?.address) {
      setUserAddress(privyWallet.address)
    } else {
      setUserAddress('')
      setErringPayments([])
    }
  }, [authenticated, privyWallet?.address])

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
        Connected wallet address to perform withdrawal:
        <br />
        <span className="address-label">{privyWallet?.address || 'Loading...'}</span>
        <br />
        <button className="disconnect" onClick={logout}>Disconnect</button>
      </p>
    )
  }

  // Selection screen
  if (screen === 'selection') {
    return (
      <div id="selection-screen" className="container short">
        <h2 className="text-center">Payment Withdrawal</h2>

        <div className="confirm-content">
          <div className="input-label text-center">
            Withdraw an incomplete payment using the payment's owner wallet.
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
                  onClick={() => handleWithdrawClick(payment, payment.balances)}
                >
                  Withdraw
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
      <h2 className="text-center">Withdraw</h2>
      <div id="back-button" className="back-button" onClick={handleBack}></div>
      <br />
      <span className="input-label text-center">
        No user gas tokens are spent when executing a withdrawal.
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
            <div className="token-name">{option.tokenName}</div>
            <div className="token-amount">Amount stuck: {option.amount}</div>
            <div className="transaction">
              {option.txExplorer && (
                <a target="_blank" rel="noreferrer" href={option.txExplorer}>See Withdraw Transaction</a>
              )}
            </div>
            <button
              className={`small-button ${option.isLoading ? 'loading' : ''}`}
              onClick={() => handleSignWithdraw(index)}
              disabled={option.isComplete}
            >
              Sign &amp; Submit Withdrawal
            </button>
          </div>
        ))}
      </div>

      <br />
      <div className="powered-by sink">Powered by Halliday</div>
    </div>
  )
}

export default Withdraw