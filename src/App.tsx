import { useState, useEffect } from 'react'
import { LoginPage } from './pages/LoginPage'
import { UnlockPage } from './pages/UnlockPage'
import { DashboardPage } from './pages/DashboardPage'
import { WayneClient } from './wayne_client'
import type { KeyEnvelopeDto } from './wayne_dto'
import './App.css'

type MkekBootstrapResponse = {
  password_salt: number[]
  mkek: {
    nonce: number[]
    payload: number[]
  }
}

type AppPage = 'login' | 'unlock' | 'dashboard'

const STORAGE_KEY = 'aether_drive_bootstrap_data'

function loadBootstrapData(): MkekBootstrapResponse | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored) as MkekBootstrapResponse
    } catch (e) {
      console.error('Failed to parse stored bootstrap data:', e)
      localStorage.removeItem(STORAGE_KEY)
    }
  }
  return null
}

function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('login')
  const [wayneBaseUrl, setWayneBaseUrl] = useState('https://eather.io')
  const [wayneClient, setWayneClient] = useState<WayneClient | null>(null)
  const [wayneEnvelopeId, setWayneEnvelopeId] = useState<string | null>(null)
  const [useWayne, setUseWayne] = useState(false)
  const [isUnlocked, setIsUnlocked] = useState(false)

  // Détermine la page initiale au chargement et restaure la session Wayne
  useEffect(() => {
    const initialBootstrapData = loadBootstrapData()
    const storedWayneEnvelopeId = localStorage.getItem('wayne_envelope_id')
    
    // Tente de restaurer la session Wayne automatiquement
    const restoreWayneSession = async () => {
      const client = new WayneClient({ baseUrl: wayneBaseUrl })
      const sessionRestored = await client.restoreSession()
      
      if (sessionRestored && client.getAccessToken()) {
        // Session restaurée avec succès
        setWayneClient(client)
        setUseWayne(true)
        
        // Si on a un envelope ID, on le récupère
        if (storedWayneEnvelopeId) {
          setWayneEnvelopeId(storedWayneEnvelopeId)
        }
      }
    }
    
    restoreWayneSession()
    
    // Si on a des données de bootstrap, on peut aller directement à unlock
    if (initialBootstrapData) {
      setCurrentPage('unlock')
    }
    
    // Si on a un envelope ID Wayne, on le stocke
    if (storedWayneEnvelopeId) {
      setWayneEnvelopeId(storedWayneEnvelopeId)
    }
  }, [wayneBaseUrl])

  const handleWayneLoginSuccess = (client: WayneClient, envelopeId: string | null) => {
    setWayneClient(client)
    setWayneEnvelopeId(envelopeId)
    setUseWayne(true)
    setCurrentPage('unlock')
  }

  const handleBootstrap = (data: MkekBootstrapResponse) => {
    setIsUnlocked(true)
    setCurrentPage('dashboard')
  }

  const handleUnlock = () => {
    setIsUnlocked(true)
    setCurrentPage('dashboard')
  }

  const handleLogout = async () => {
    // Déconnexion côté Wayne si un client est actif
    if (wayneClient) {
      try {
        await wayneClient.logout()
      } catch (error) {
        console.error('Erreur lors de la déconnexion Wayne:', error)
        // Continue même si la déconnexion échoue
      }
    }
    
    setIsUnlocked(false)
    setWayneClient(null)
    setWayneEnvelopeId(null)
    setUseWayne(false)
    setCurrentPage('login')
  }

  return (
    <div className="app">
      {currentPage === 'login' && (
        <LoginPage
          wayneBaseUrl={wayneBaseUrl}
          onWayneBaseUrlChange={setWayneBaseUrl}
          onLoginSuccess={handleWayneLoginSuccess}
        />
      )}

      {currentPage === 'unlock' && (
        <UnlockPage
          wayneClient={wayneClient}
          useWayne={useWayne}
          onBootstrap={handleBootstrap}
          onUnlock={handleUnlock}
          onGoToLogin={() => setCurrentPage('login')}
          onDisableWayne={() => {
            setUseWayne(false)
            setWayneClient(null)
            setWayneEnvelopeId(null)
            localStorage.removeItem('wayne_envelope_id')
          }}
          hasWayneEnvelopeId={!!wayneEnvelopeId}
        />
      )}

      {currentPage === 'dashboard' && isUnlocked && (
        <DashboardPage wayneClient={wayneClient} onLogout={handleLogout} />
      )}
    </div>
  )
}

export default App

