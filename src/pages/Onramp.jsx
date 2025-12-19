import { useState, useEffect, useRef } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth';

const HALLIDAY_API_KEY = import.meta.env.VITE_HALLIDAY_API_KEY
const INPUT_ASSET = 'usd'
const OUTPUT_ASSET = 'story:0x'
const ONRAMPS = ['stripe', 'transak', 'moonpay']
const FIAT_ONRAMP_PAY_IN_METHODS = ['CREDIT_CARD']

function Onramp() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  let privyLoginSection;

  // State for form inputs
  const [payAmount, setPayAmount] = useState('')
  const [address, setAddress] = useState('')
  const [selectedOnramp, setSelectedOnramp] = useState('stripe')
  
  // State for UI
  const [screen, setScreen] = useState('input') // 'input' or 'onramp'
  const [isLoading, setIsLoading] = useState(false)
  const [onrampUrl, setOnrampUrl] = useState('')
  
  // State for quotes
  const [quotes, setQuotes] = useState(() => {
    const initial = {}
    ONRAMPS.forEach(onramp => {
      initial[onramp] = {
        outputAmount: '0',
        inputAmount: '0',
        expiration: new Date(0)
      }
    })
    return initial
  })

  // Refs for timers
  const loadingTimeoutRef = useRef(null)
  const paymentStatusIntervalRef = useRef(null)
  const paymentIdRef = useRef(null)

  // Validation helpers
  const validateAmountInput = (value) => /^[0-9]*\.?[0-9]*$/.test(value)
  const isValidEthAddress = (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr)

  // Derived state
  const currentQuote = quotes[selectedOnramp]
  const outputAmount = parseFloat(currentQuote?.outputAmount) || 0
  const isAmountValid = outputAmount > 0
  const isAddressValid = isValidEthAddress(address)
  const canContinue = isAmountValid && isAddressValid && !isLoading

  // Format display values
  const receiveAmount = outputAmount > 0 ? outputAmount.toFixed(6) : '-'
  const receiveUsd = (() => {
    if (!currentQuote?.price) return '$-'
    if (isNaN(+currentQuote.price)) return currentQuote.price
    const price = (+currentQuote.price).toFixed(2)
    const aggPrice = (+currentQuote.prices?.[OUTPUT_ASSET] || 0).toFixed(2)
    const fees = (+currentQuote.fees || 0).toFixed(3)
    return `$${price} per token, Total fees $${fees}. IP price $${aggPrice}.`
  })()

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
          output_asset: OUTPUT_ASSET,
        },
        price_currency: 'usd',
        onramps: ONRAMPS,
        onramp_methods: FIAT_ONRAMP_PAY_IN_METHODS,
        customer_geolocation: { alpha3_country_code: 'USA' }
      }),
    })

    const data = await res.json()
    console.log('getQuote', data)

    const expiration = new Date(data.accept_by)
    const stateToken = data.state_token
    const newQuotes = {}

    // Initialize with empty quotes
    ONRAMPS.forEach(onramp => {
      newQuotes[onramp] = { outputAmount: '0', inputAmount: '0', expiration: new Date(0) }
    })

    // Process successful quotes
    data.quotes.forEach((quoteData) => {
      const onramp = quoteData.onramp
      const outputAmt = +quoteData.output_amount.amount
      newQuotes[onramp] = {
        onramp,
        stateToken,
        paymentId: quoteData.payment_id,
        outputAmount: outputAmt,
        inputAmount,
        expiration,
        price: (inputAmount / outputAmt).toString(),
        fees: +quoteData.fees.total_fees,
        prices: data.current_prices,
      }
    })

    // Process failures
    data.failures?.forEach((f) => {
      if (f?.issues?.[0]?.message?.includes('Given amount is') && f?.issues?.[0]?.source) {
        const issue = f.issues[0]
        const onramp = issue.source
        if (!newQuotes[onramp]?.price) {
          newQuotes[onramp].price = `Error: ${issue.message}`
          newQuotes[onramp].expiration = expiration
        }
      }
    })

    setQuotes(newQuotes)
  }

  async function acceptQuote() {
    const selectedQuote = quotes[selectedOnramp]
    const res = await fetch('https://v2.prod.halliday.xyz/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payment_id: selectedQuote.paymentId,
        state_token: selectedQuote.stateToken,
        owner_address: address,
        destination_address: address
      })
    })
    const data = await res.json()
    console.log('acceptQuote', data)
    return data
  }

  async function getPaymentStatus(paymentId) {
    const res = await fetch(`https://v2.prod.halliday.xyz/payments?payment_id=${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + HALLIDAY_API_KEY,
        'Content-Type': 'application/json'
      },
    })
    return res.json()
  }

  // Event handlers
  function handlePayAmountChange(e) {
    const value = e.target.value
    if (!validateAmountInput(value)) return
    setPayAmount(value)
  }

  async function handleContinue() {
    if (!canContinue) return

    setIsLoading(true)
    const acceptedQuote = await acceptQuote()
    const paymentId = acceptedQuote.payment_id
    paymentIdRef.current = paymentId

    paymentStatusIntervalRef.current = setInterval(async () => {
      console.log('payment status:', paymentId, await getPaymentStatus(paymentId))
    }, 5000)

    setIsLoading(false)
    setOnrampUrl(acceptedQuote.next_instruction.funding_page_url)
    setScreen('onramp')
  }

  function handleBack() {
    clearInterval(paymentStatusIntervalRef.current)
    setScreen('input')
  }

  // Effect: debounced quote fetching when payAmount changes
  useEffect(() => {
    if (!payAmount || payAmount === '0') return

    setIsLoading(true)
    clearTimeout(loadingTimeoutRef.current)

    loadingTimeoutRef.current = setTimeout(async () => {
      await getQuote(payAmount)
      setIsLoading(false)
    }, 2000)

    return () => clearTimeout(loadingTimeoutRef.current)
  }, [payAmount])

  // Effect: refresh expired quotes
  useEffect(() => {
    const interval = setInterval(() => {
      const firstQuote = quotes[ONRAMPS[0]]
      if (!isLoading && payAmount && firstQuote.expiration < Date.now()) {
        getQuote(payAmount)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [payAmount, quotes, isLoading])

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
      clearInterval(paymentStatusIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (!authenticated) {
      setAddress('');
    } else {
      const privyWallet = wallets.find(w => w.walletClientType === 'privy');
      if (privyWallet?.address) {
        setAddress(privyWallet.address);
      }
    }
  }, [authenticated, wallets]);

  if (!ready) {
    privyLoginSection = (
      <span className="address-label">Loading...</span>
    );
  }

  if (!authenticated) {
    privyLoginSection = (
      <button className="button enabled" onClick={login}>
        Sign in with Privy
      </button>
    );
  } else {
    privyLoginSection = (
      <>
        <span className="address-label">Privy Wallet Address: {(wallets.find(w => w.walletClientType === 'privy'))?.address || 'Loading...'}</span>
        <button className="button enabled" onClick={() => {
          logout();
        }}>
          Logout Privy
        </button>
      </>
    );
  }

  // Input screen
  if (screen === 'input') {
    return (
      <div id="input-screen" className="container">
        <h2 className="text-center">Onramp to IP</h2>

        <div className="radio-group">
          {ONRAMPS.map(onramp => (
            <div className="radio-option" key={onramp}>
              <input
                type="radio"
                id={onramp}
                name="provider"
                value={onramp}
                checked={selectedOnramp === onramp}
                onChange={(e) => setSelectedOnramp(e.target.value)}
              />
              <label htmlFor={onramp}>{onramp.charAt(0).toUpperCase() + onramp.slice(1)}</label>
            </div>
          ))}
        </div>

        <div className="input-section">
          <div className="input-label">You pay</div>
          <div className="input-container">
            <input
              type="text"
              className="amount-input"
              id="pay-amount"
              placeholder="-"
              autoComplete="off"
              value={payAmount}
              onChange={handlePayAmountChange}
              autoFocus
            />
            <div className="currency-label">
              USD <label alt="USD" className="token-icon usa-icon"></label>
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

        <div className="confirm-content">
          <div className="input-label">
            Privy wallet address to onramp $IP to on Story. This Privy wallet address will own the payment, <a href="https://docs.halliday.xyz/pages/otw" target="_blank" rel="noreferrer">learn more here</a>.
          </div>

          { privyLoginSection }

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

  // Onramp screen
  return (
    <div id="onramp-screen" className="container">
      <div id="back-button" className="back-button" onClick={handleBack}></div>
      <iframe id="onramp-iframe" className="onramp-iframe" src={onrampUrl} title="Onramp"></iframe>
      <div className="powered-by">Powered by Halliday</div>
    </div>
  )
}

export default Onramp