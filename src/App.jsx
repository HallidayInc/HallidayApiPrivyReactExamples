import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Onramp from './pages/Onramp'
import Swap from './pages/Swap'
import Retry from './pages/Retry'
import Withdraw from './pages/Withdraw'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/onramp" element={<Onramp />} />
        <Route path="/swap" element={<Swap />} />
        <Route path="/retry" element={<Retry />} />
        <Route path="/withdraw" element={<Withdraw />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App