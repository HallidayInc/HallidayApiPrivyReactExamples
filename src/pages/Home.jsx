import { Link } from 'react-router-dom'

function Home() {
  const examples = [
    {
      to: '/onramp',
      title: 'Onramp',
      description: 'Convert fiat currency to IP tokens via Stripe, Transak, or Moonpay'
    },
    {
      to: '/swap',
      title: 'Swap',
      description: 'Cross-chain swap from Base USDC to IP tokens'
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