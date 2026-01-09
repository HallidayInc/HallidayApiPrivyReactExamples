import { useState, useEffect, useRef } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { ethers } from 'ethers'

const HALLIDAY_API_KEY = import.meta.env.VITE_HALLIDAY_API_KEY
const FROM_CHAIN_ID = 8453 // Base mainnet (decimal for Privy)
const INPUT_TOKEN_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC on Base
const INPUT_ASSET = 'base:' + INPUT_TOKEN_ADDRESS
const OUTPUT_ASSET = 'story:0x'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

function Swap() {
  const { ready, authenticated, login, logout } = usePrivy()
  const { wallets } = useWallets()

  // State for form inputs
  const [amount, setAmount] = useState('')
  const [userAddress, setUserAddress] = useState('')

  // State for UI
  const [screen, setScreen] = useState('input') // 'input' or 'swap'
  const [isLoading, setIsLoading] = useState(false)
  const [walletBalance, setWalletBalance] = useState(null)

  // State for quote
  const [quote, setQuote] = useState({
    outputAmount: '0',
    inputAmount: '0',
    expiration: new Date(0)
  })

  // State for swap status screen
  const [swapData, setSwapData] = useState(null)
  const [swapStatus, setSwapStatus] = useState(null)

  // Refs
  const loadingTimeoutRef = useRef(null)
  const statusIntervalRef = useRef(null)

  // Get wallet, may be Privy embedded or other like EIP-1193
  // const wallet = wallets.find(w => w.walletClientType === 'privy')
  const wallet = wallets[0]

  // Validation helpers
  const validateAmountInput = (value) => /^[0-9]*\.?[0-9]*$/.test(value)

  // Derived state
  const outputAmount = parseFloat(quote?.outputAmount) || 0
  const isAmountValid = outputAmount > 0
  const isOverBalance = walletBalance && +amount > +walletBalance
  const canContinue = isAmountValid && authenticated && !isLoading && !isOverBalance

  // Format display values
  const receiveAmount = outputAmount > 0 ? outputAmount.toFixed(6) : '-'
  const receiveUsd = (() => {
    if (!quote?.price) return '$-'
    if (isNaN(+quote.price)) return quote.price
    return `$${(+quote.price).toFixed(2)} per token`
  })()

  // Get ERC20 balance
  async function getErc20Balance(address, contract) {
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals()
    ])
    return [balance, decimals]
  }

  // Show wallet balance of input token
  async function showWalletBalanceOfInputToken(address) {
    if (!wallet) return

    try {
      // Switch to Base chain if needed
      await wallet.switchChain(FROM_CHAIN_ID)

      const ethersProvider = await wallet.getEthereumProvider()
      const provider = new ethers.BrowserProvider(ethersProvider)
      const inputTokenContract = new ethers.Contract(INPUT_TOKEN_ADDRESS, ERC20_ABI, provider)
      const [balance, decimals] = await getErc20Balance(address, inputTokenContract)
      const formattedBalance = ethers.formatUnits(balance, decimals)
      setWalletBalance(formattedBalance)
    } catch (e) {
      console.error('Error fetching balance', e)
    }
  }

  // API calls
  async function getQuote(inputAmount) {
    const res = await fetch('https://v2.prod.halliday.xyz/payments/quotes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        request: {
          kind: 'FIXED_INPUT',
          fixed_input_amount: { asset: INPUT_ASSET, amount: inputAmount },
          output_asset: OUTPUT_ASSET
        },
        price_currency: 'USD'
      })
    })

    const data = await res.json()
    console.log('getQuote', data)

    const expiration = new Date(data.accept_by)
    const stateToken = data.state_token

    let bestQuote = {
      outputAmount: '0',
      inputAmount: '0',
      expiration: new Date(0)
    }

    data.quotes.forEach((quoteData) => {
      const paymentId = quoteData.payment_id
      const outputAmt = quoteData.output_amount.amount
      const price = (inputAmount / outputAmt).toString()

      const newQuote = {
        stateToken,
        paymentId,
        outputAmount: outputAmt,
        inputAmount,
        expiration,
        price,
      }

      // Optimize for the best quote
      if (
        expiration >= bestQuote.expiration ||
        (expiration >= bestQuote.expiration && price <= bestQuote.price)
      ) {
        bestQuote = newQuote
      }
    })

    data.failures?.forEach((f, i) => {
      console.log('Quote failure', f, i)
    })

    setQuote(bestQuote)
  }

  async function acceptQuote() {
    const requestBody = {
      payment_id: quote.paymentId,
      state_token: quote.stateToken,
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

    if (!res.ok) {
      throw new Error(JSON.stringify(data))
    }

    console.log('acceptQuote', data)
    return data
  }

  async function getSwapStatus(paymentId) {
    const res = await fetch(`https://v2.prod.halliday.xyz/payments?payment_id=${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
        'Content-Type': 'application/json'
      }
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(JSON.stringify(data))
    }

    console.log('getSwapStatus', data)
    return data
  }

  // Event handlers
  function handleAmountChange(e) {
    const value = e.target.value
    if (!validateAmountInput(value)) return
    setAmount(value)
  }

  async function handleContinue() {
    if (!canContinue) return

    setIsLoading(true)

    try {
      const acceptedSwap = await acceptQuote()
      setSwapData(acceptedSwap)

      // Start polling for status
      statusIntervalRef.current = setInterval(async () => {
        try {
          const status = await getSwapStatus(acceptedSwap.payment_id)
          setSwapStatus(status)
        } catch (e) {
          console.error('Error fetching swap status', e)
        }
      }, 5000)

      // Get initial status
      const initialStatus = await getSwapStatus(acceptedSwap.payment_id)
      setSwapStatus(initialStatus)

      setIsLoading(false)
      setScreen('swap')

      // Fund the swap using Privy wallet
      const fundAmount = acceptedSwap.quoted.route[0].net_effect.consume[0].amount
      const fundAddress = acceptedSwap.processing_addresses[0].address

      await wallet.switchChain(FROM_CHAIN_ID)
      const ethersProvider = await wallet.getEthereumProvider()
      const provider = new ethers.BrowserProvider(ethersProvider)
      const signer = await provider.getSigner()
      const inputTokenWithSigner = new ethers.Contract(INPUT_TOKEN_ADDRESS, ERC20_ABI, signer)
      const decimals = await inputTokenWithSigner.decimals()

      const tx = await inputTokenWithSigner.transfer(
        fundAddress,
        ethers.parseUnits(fundAmount, decimals)
      )
      await tx.wait()
    } catch (e) {
      console.error('Error with swap', e)
      setIsLoading(false)
    }
  }

  function handleBack() {
    clearInterval(statusIntervalRef.current)
    setScreen('input')
    setSwapData(null)
    setSwapStatus(null)
  }

  // Effect: set address when authenticated
  useEffect(() => {
    if (authenticated && wallet?.address) {
      setUserAddress(wallet.address)
      showWalletBalanceOfInputToken(wallet.address)
    } else {
      setUserAddress('')
      setWalletBalance(null)
    }
  }, [authenticated, wallet?.address])

  // Effect: debounced quote fetching
  useEffect(() => {
    if (!amount || amount === '0' || !authenticated) return

    setIsLoading(true)
    clearTimeout(loadingTimeoutRef.current)

    loadingTimeoutRef.current = setTimeout(async () => {
      await getQuote(amount)
      setIsLoading(false)
    }, 2000)

    return () => clearTimeout(loadingTimeoutRef.current)
  }, [amount, authenticated])

  // Effect: refresh expired quotes
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isLoading && amount && quote.expiration && quote.expiration < Date.now()) {
        getQuote(amount)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [amount, quote, isLoading])

  // Effect: alert if API key missing
  useEffect(() => {
    if (!HALLIDAY_API_KEY || HALLIDAY_API_KEY === '_your_api_key_here_') {
      alert('HALLIDAY_API_KEY is missing!')
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(loadingTimeoutRef.current)
      clearInterval(statusIntervalRef.current)
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
        Connected wallet address to perform swap:
        <br />
        <span className="address-label">{wallet?.address || 'Loading...'}</span>
        <br />
        <button className="disconnect" onClick={logout}>Disconnect</button>
      </p>
    )
  }

  // Swap status helpers
  const getSwapContext = () => {
    if (!swapStatus) return 'Loading...'
    if (swapStatus.status === 'COMPLETE') {
      return 'Complete! Check the address on the destination chain for a transfer in of the additional output tokens.'
    }
    if (swapStatus.status === 'PENDING' && swapStatus.fulfilled?.route?.[0]?.status === 'PENDING') {
      const fundAmount = swapStatus.quoted?.route?.[0]?.net_effect?.consume?.[0]?.amount
      const fundAddress = swapStatus.processing_addresses?.[0]?.address
      return `Pending means the processing address (${fundAddress}) is waiting to be funded with ${fundAmount} tokens.`
    }
    return 'Check the browser console logs for more information'
  }

  // Input screen
  if (screen === 'input') {
    return (
      <div id="input-screen" className="container">
        <h2 className="text-center">Cross-Chain Swap</h2>

        <div className="connect-wallet-container">
          {privyLoginSection}
        </div>

        <div className="input-section">
          <div className="input-label">You pay</div>
          <div className="input-container">
            <input
              type="text"
              className={`amount-input ${isOverBalance ? 'red-text' : ''}`}
              id="amount-input"
              placeholder="-"
              autoComplete="off"
              value={amount}
              onChange={handleAmountChange}
            />
            <div className="input-available" id="input-available">
              Available in Wallet: {walletBalance ?? '-'}
            </div>
            <div className="currency-label">
              Base USDC <label alt="USDC on Base" className="token-icon usdc-icon"></label>
            </div>
          </div>
        </div>

        <div className="output-section">
          <div className="output-label">You receive</div>
          <div className="output-container">
            <div className="output-amount" id="receive-amount">{receiveAmount}</div>
            <div className="output-usd" id="receive-usd">{receiveUsd}</div>
            <div className="output-currency">
              IP <img src="https://coin-images.coingecko.com/coins/images/54035/large/Transparent_bg.png?1738075331" alt="IP" className="token-icon" />
            </div>
          </div>
        </div>

        <div className="terms-container">
          <label className="terms-label">
            By clicking Continue, I accept the <a href="https://halliday.xyz/legal/terms-of-use" target="_blank" rel="noreferrer">Halliday Terms & Conditions</a>.
          </label>
        </div>

        <button
          className={`button ${isLoading ? 'loading' : ''} ${canContinue ? 'enabled' : ''}`}
          id="continue-button"
          disabled={!canContinue}
          onClick={handleContinue}
        >
          Continue
        </button>

        <div className="powered-by">Powered by Halliday</div>
      </div>
    )
  }

  // Swap screen
  return (
    <div id="swap-screen" className="container">
      <h2 className="text-center">Cross-Chain Swap</h2>
      <div id="back-button" className="back-button" onClick={handleBack}></div>

      <span className="workflow-detail-label">Last Update:</span>
      <span className="workflow-detail-value">{swapStatus?.updated_at || '-'}</span>
      <br />

      <span className="workflow-detail-label">ID:</span>
      <span className="workflow-detail-value">{swapData?.payment_id || '-'}</span>
      <br />

      <span className="workflow-detail-label">Swap Steps:</span>
      <ul id="swap-steps-list">
        {swapStatus?.fulfilled?.route?.map((step, i) => (
          <li key={i}>{step.type}: {step.status}</li>
        ))}
      </ul>

      <span className="workflow-detail-label">Swap Status:</span>
      <span className="workflow-detail-value">{swapStatus?.status || '-'}</span>
      <br />

      <span className="workflow-detail-label">Context:</span>
      <span className="workflow-detail-value">{getSwapContext()}</span>
      <br />

      {swapStatus?.status !== 'COMPLETE' && (
        <div className="swap-loading-spinner loading-spinner"></div>
      )}

      <div className="powered-by sink">Powered by Halliday</div>
    </div>
  )
}

export default Swap