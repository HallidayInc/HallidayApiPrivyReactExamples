import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'

function Home() {
  const [theme, setTheme] = useState(() => {
    // Check for saved preference, otherwise use 'auto'
    return localStorage.getItem('theme') || 'auto'
  })

  useEffect(() => {
    const root = document.documentElement
    
    // Remove existing theme classes
    root.classList.remove('light', 'dark')
    
    if (theme !== 'auto') {
      root.classList.add(theme)
    }
    
    // Save preference
    localStorage.setItem('theme', theme)
  }, [theme])

  const cycleTheme = () => {
    setTheme(current => {
      if (current === 'auto') return 'light'
      if (current === 'light') return 'dark'
      return 'auto'
    })
  }

  const getThemeIcon = () => {
    if (theme === 'light') return '☀️'
    if (theme === 'dark') return '🌙'
    return '🖥️' // auto/system
  }

  const getThemeLabel = () => {
    if (theme === 'light') return 'Light'
    if (theme === 'dark') return 'Dark'
    return 'Auto'
  }

  const examples = [
    {
      to: '/onramp',
      title: 'Onramp',
      description: 'Convert fiat currency to IP tokens via Stripe, Transak, or Moonpay'
    },
    {
      to: '/swap',
      title: 'Swap',
      description: 'Cross-chain swap from Base USDC to IP on Story mainnet'
    },
    {
      to: '/retry',
      title: 'Retry',
      description: 'Retry incomplete payments that have stuck funds'
    },
    {
      to: '/withdraw',
      title: 'Withdraw',
      description: 'Withdraw stuck funds from incomplete payments'
    }
  ]

  return (
    <div className="home-container">
      <div className="home-header">
        <h1>Halliday API Examples</h1>
        <p className="home-subtitle">with Privy and React</p>
      </div>

      <button className="theme-toggle" onClick={cycleTheme} title={`Theme: ${getThemeLabel()}`}>
        <span className="theme-icon">{getThemeIcon()}</span>
        <span className="theme-label">{getThemeLabel()}</span>
      </button>

      <div className="home-grid">
        {examples.map((example) => (
          <Link to={example.to} key={example.to} className="home-card">
            <h2>{example.title}</h2>
            <p>{example.description}</p>
            <span className="home-card-arrow">→</span>
          </Link>
        ))}
      </div>

      <div className="home-footer">
        <a href="https://docs.halliday.xyz" target="_blank" rel="noreferrer">
          Halliday Docs
        </a>
        <a href="https://docs.privy.io" target="_blank" rel="noreferrer">
          Privy Docs
        </a>
      </div>
    </div>
  )
}

export default Home