/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AdminInterface from './components/AdminInterface.tsx';
import UserInterface from './components/UserInterface.tsx';
import PartnerInterface from './components/PartnerInterface.tsx';
import BusinessIntroducerInterface from './components/BusinessIntroducerInterface.tsx';
import Sidebar from './components/Sidebar.tsx';
import { auth, db, getDoc, getDocs, setDoc, updateDoc, trackAppHostingStaticAssets } from './lib/firebase';
import { doc, serverTimestamp, increment, disableNetwork, enableNetwork, collection, query, where } from 'firebase/firestore';
import { LogIn, User, Lock, Loader2, AlertCircle, MessageCircle, WifiOff, Download, X, Play, GraduationCap, ChevronRight, CheckCircle2, ArrowRight, Star } from 'lucide-react';
import { cn, safeLocalStorage } from './lib/utils';
import { FILIERE_OPTIONS, getLevelsForFiliere } from './lib/constants';

interface CustomUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'student' | 'partner' | 'apporteur';
  isDemo?: boolean;
  filiere?: string;
  niveau?: string;
}

const getOrCreateDeviceId = () => {
  let devId = safeLocalStorage.getItem('ais_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
    safeLocalStorage.setItem('ais_device_id', devId);
  }
  return devId;
};

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState<'admin' | 'student' | 'partner' | 'apporteur'>('student');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [isExamActive, setIsExamActive] = useState(false);
  const [currentUser, setCurrentUser] = useState<CustomUser | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isPWAInstalled, setIsPWAInstalled] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    }
    return false;
  });
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showInstallInstructions, setShowInstallInstructions] = useState(false);
  const [showFiliereSelection, setShowFiliereSelection] = useState(false);
  const [showDemoFiliereSelection, setShowDemoFiliereSelection] = useState(false);
  const [tempSelection, setTempSelection] = useState({ filiere: '', niveau: '' });
  
  const [partnerWorkspaceMode, setPartnerWorkspaceMode] = useState<'partner' | 'student'>(() => {
    const saved = safeLocalStorage.getItem('ais_partner_mode');
    return saved === 'student' ? 'student' : 'partner';
  });
  const [currentPartnerFiliere, setCurrentPartnerFiliere] = useState<string>(() => {
    return safeLocalStorage.getItem('ais_partner_filiere') || 'ECN';
  });
  
  const [loginForm, setLoginForm] = useState({
    username: '',
    password: '',
    promoCode: ''
  });

  const location = useLocation();
  const navigate = useNavigate();

  // Migration and Session Check
  useEffect(() => {
    // 1. Immediately force ready state after a short delay as fallback
    const authTimeout = setTimeout(() => {
      setIsAuthReady(true);
    }, 3000);

    const initAuth = async () => {
      try {
        // Run migration in background without blocking
        const ensureAdminCreated = async () => {
          try {
            const adminRef = doc(db, 'users', 'neel');
            const adminDoc = await getDoc(adminRef);
            if (!adminDoc.exists()) {
              await setDoc(adminRef, {
                username: 'neel',
                password: 'NeelPassword2026!',
                displayName: 'Nelle Djofang',
                role: 'admin',
                createdAt: serverTimestamp()
              });
            }
          } catch (err) {
            console.warn("Migration error (can be ignored):", err);
          }
        };
        ensureAdminCreated();

        // 2. Check local session immediately
        const savedUser = safeLocalStorage.getItem('ais_user');
        
        if (savedUser) {
          try {
            const userData = JSON.parse(savedUser) as CustomUser;
            
            if (userData.isDemo) {
              setCurrentUser(userData);
              setIsAdmin(false);
              setUserRole('student');
              setIsAuthReady(true);
              clearTimeout(authTimeout);
              return;
            }

            // Verify status and license synchronously on reload/open to be fully accurate
            const userRef = doc(db, 'users', userData.username);
            const userDoc = await getDoc(userRef);

            if (userDoc.exists()) {
              const data = userDoc.data();
              
              // Verify status and license
              const expiresAtVal = data.expiresAt;
              let isExpired = false;
              if (expiresAtVal && data.role !== 'admin') {
                const expiry = expiresAtVal.toDate ? expiresAtVal.toDate() : new Date(expiresAtVal);
                if (new Date() > expiry) {
                  isExpired = true;
                }
              }

              // Check if status is active (which corresponds to "connecté"/active)
              const isActive = data.status === 'active' || !data.status;
              
              if (isActive && !isExpired) {
                const user: CustomUser = {
                  id: userDoc.id,
                  username: data.username,
                  displayName: data.displayName,
                  role: data.role,
                  filiere: data.filiere || userData.filiere || 'ECN',
                  niveau: data.niveau || userData.niveau || 'ALL'
                };
                setCurrentUser(user);
                setIsAdmin(data.role === 'admin');
                setUserRole(data.role);
                safeLocalStorage.setItem('ais_user', JSON.stringify(user));
              } else {
                // Otherwise user status inactive/suspended or license expired: force login
                setCurrentUser(null);
                setIsAdmin(false);
                setUserRole('student');
                safeLocalStorage.removeItem('ais_user');
              }
            } else {
              // User no longer exists
              setCurrentUser(null);
              setIsAdmin(false);
              setUserRole('student');
              safeLocalStorage.removeItem('ais_user');
            }
          } catch (e) {
            console.warn("Background auth verification failed or offline, falling back to cached session", e);
            // In case of error (e.g. offline), we trust the cached user
            const userData = JSON.parse(savedUser) as CustomUser;
            setCurrentUser(userData);
            setIsAdmin(userData.role === 'admin');
            setUserRole(userData.role || 'student');
          }
        }
      } catch (globalErr) {
        console.error("Global auth init error:", globalErr);
      } finally {
        setIsAuthReady(true);
        clearTimeout(authTimeout);
      }
    };

    initAuth();
  }, []);

  // App Hosting Static Assets Telemetry
  useEffect(() => {
    if (currentUser) {
      trackAppHostingStaticAssets();
    }
  }, [currentUser]);

  // PWA & Offline logic
  useEffect(() => {
    // Detect device environment
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent) || 
                       (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      
      // Show banner after a short delay if not already installed
      const isInstalled = window.matchMedia('(display-mode: standalone)').matches;
      const hasDismissed = safeLocalStorage.getItem('pwa_install_dismissed') === 'true';
      
      if (!isInstalled && !hasDismissed) {
        setTimeout(() => setShowInstallBanner(true), 5000);
      }
    };

    // For iOS, we can't capture beforeinstallprompt, so we show the banner based on detection
    if (isIOSDevice) {
      const isInstalled = window.matchMedia('(display-mode: standalone)').matches;
      const hasDismissed = safeLocalStorage.getItem('pwa_install_dismissed') === 'true';
      if (!isInstalled && !hasDismissed) {
        setTimeout(() => setShowInstallBanner(true), 5000);
      }
    }

    const handleAppInstalled = () => {
      setIsPWAInstalled(true);
      setShowInstallBanner(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Handle visibility changes for iOS/Safari suspend network issues cleanly
    let networkActionPromise: Promise<void> | null = null;
    const handleVisibilityChange = () => {
      if (!isIOSDevice) return;
      
      const isVisible = document.visibilityState === 'visible';
      
      const performNetworkAction = async () => {
        try {
          if (networkActionPromise) {
            await networkActionPromise;
          }
          if (isVisible) {
            await enableNetwork(db);
            console.log('Firebase network enabled.');
          } else {
            await disableNetwork(db);
            console.log('Firebase network disabled.');
          }
        } catch (err) {
          console.warn(`Error changing network state to ${isVisible ? 'enabled' : 'disabled'}:`, err);
        }
      };

      networkActionPromise = performNetworkAction();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowInstallInstructions(true);
      setShowInstallBanner(false);
      return;
    }

    if (!deferredPrompt) {
      setShowInstallInstructions(true);
      setShowInstallBanner(false);
      return;
    }

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      }
    } catch (err) {
      console.warn("Could not prompt installation automatically:", err);
      setShowInstallInstructions(true);
    }
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    // Optional: persist dismissal for 24h or per session
    // localStorage.setItem('pwa_install_dismissed', 'true');
  };

  const renderInstallInstructionsModal = () => {
    if (!showInstallInstructions) return null;
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="bg-white rounded-[2.5rem] w-full max-w-md p-6 sm:p-8 space-y-6 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center animate-pulse">
                <Download className="w-5 h-5 text-blue-650" />
              </div>
              <div>
                <h3 className="font-black text-gray-950 text-lg leading-tight">Installer Smart Tutor</h3>
                <p className="text-[10px] text-gray-400 font-mono tracking-wider font-semibold uppercase">PWA (Application Web)</p>
              </div>
            </div>
            <button 
              onClick={() => setShowInstallInstructions(false)}
              className="p-1.5 text-gray-400 hover:text-gray-650 hover:bg-gray-100 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="bg-gradient-to-br from-indigo-50/50 to-blue-50/50 p-4 rounded-3xl border border-blue-50/50 space-y-2">
              <p className="text-xs text-gray-650 leading-relaxed font-semibold">
                L'installation de l'application ajoute une icône sur votre écran d'accueil avec une fluidité maximale, un mode immersif et un accès direct pour vos révisions.
              </p>
            </div>

            <div className="space-y-4">
              <div className="border-l-4 border-blue-500 pl-4 py-1 space-y-1">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide">Sur Android (Chrome)</h4>
                <p className="text-xs text-gray-500 leading-relaxed font-semibold">
                  1. Cliquez sur les <span className="font-black text-gray-800">trois points verticaux ⋮</span> en haut à droite de Google Chrome.<br />
                  2. Sélectionnez <span className="font-black text-indigo-600">"Installer l'application"</span> ou <span className="font-black text-indigo-600">"Ajouter à l'écran d'accueil"</span>.<br />
                  3. Confirmez pour lancer l'installation !
                </p>
              </div>

              <div className="border-l-4 border-indigo-500 pl-4 py-1 space-y-1">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide">Sur iOS (iPhone & iPad)</h4>
                <p className="text-xs text-gray-500 leading-relaxed font-semibold">
                  1. Cliquez sur l'icône <span className="font-black text-gray-800">Partager 📤</span> en bas de votre écran.<br />
                  2. Sélectionnez <span className="font-black text-indigo-600">"Sur l'écran d'accueil" ➕</span>.<br />
                  3. Cliquez sur <span className="font-black text-indigo-600">"Ajouter"</span> en haut à droite.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowInstallInstructions(false)}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl font-black hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg shadow-blue-100 uppercase tracking-wider text-sm active:scale-95 text-center block"
            >
              Compris, j'installe !
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginLoading) return;
    
    setLoginLoading(true);
    setLoginError(null);
    
    try {
      const username = loginForm.username.toLowerCase().trim();
      const userRef = doc(db, 'users', username);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.password === loginForm.password) {
          if (userData.status === 'suspended' && userData.role !== 'admin') {
            setLoginError("Votre compte a été suspendu par un administrateur. Veuillez contacter le support.");
            setLoginLoading(false);
            return;
          }

          if (userData.status === 'expired' && userData.role !== 'admin') {
            setLoginError("Votre accès est expiré ou bloqué. Veuillez contacter un administrateur.");
            setLoginLoading(false);
            return;
          }

          if (userData.expiresAt && userData.role !== 'admin') {
            const expirationDate = userData.expiresAt.toDate();
            if (new Date() > expirationDate) {
              setLoginError("Votre accès a expiré. Veuillez contacter un administrateur.");
              setLoginLoading(false);
              return;
            }
          }

          const currentDevId = getOrCreateDeviceId();

          if (userData.hasLoggedIn && userData.role === 'student') {
            if (userData.deviceId && userData.deviceId !== currentDevId) {
              setLoginError("Ces identifiants ont déjà été utilisés. L'accès est limité à un seul appareil.");
              setLoginLoading(false);
              return;
            }
          }

          if (userData.role === 'student') {
            const updates: any = { 
              hasLoggedIn: true,
              deviceId: currentDevId,
              totalLogins: increment(1),
              lastLogin: serverTimestamp()
            };
            const promo = loginForm.promoCode.trim();
            if (promo) {
              updates.promoCode = promo;
              try {
                const partnerQuery = query(
                  collection(db, 'users'),
                  where('role', '==', 'partner'),
                  where('promoCode', '==', promo)
                );
                const partnerSnap = await getDocs(partnerQuery);
                if (!partnerSnap.empty) {
                  const partnerDoc = partnerSnap.docs[0];
                  updates.partnerId = partnerDoc.id;
                }
              } catch (err) {
                console.warn("Could not auto-link student to partner via promo code:", err);
              }
            }
            await updateDoc(userRef, updates);
          } else if (userData.role === 'partner') {
            await updateDoc(userRef, {
              lastLogin: serverTimestamp()
            });
          }

          const user: CustomUser = {
            id: userDoc.id,
            username: userData.username,
            displayName: userData.displayName,
            role: userData.role,
            filiere: userData.filiere || 'ECN',
            niveau: userData.niveau || 'ALL'
          };
          setCurrentUser(user);
          setIsAdmin(user.role === 'admin');
          setUserRole(user.role);
          safeLocalStorage.setItem('ais_user', JSON.stringify(user));
        } else {
          setLoginError("Mot de passe incorrect.");
        }
      } else {
        setLoginError("Utilisateur non trouvé.");
      }
    } catch (err: any) {
      console.error(err);
      setLoginError("Une erreur est survenue lors de la connexion.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleDemoAccess = async (filiere?: string, niveau?: string) => {
    // If no params, show the selection menu
    if (!filiere || !niveau) {
      setShowDemoFiliereSelection(true);
      return;
    }

    const demoUser: CustomUser = {
      id: 'demo_user',
      username: 'demo_user',
      displayName: 'Utilisateur Démo',
      role: 'student',
      isDemo: true,
      filiere: filiere,
      niveau: niveau
    };
    setCurrentUser(demoUser);
    setIsAdmin(false);
    setUserRole('student');
    safeLocalStorage.setItem('ais_user', JSON.stringify(demoUser));
    setShowDemoFiliereSelection(false);

    // Record free trial access in background without awaiting the promise
    try {
      const statsRef = doc(db, 'stats', 'global');
      setDoc(statsRef, { 
        testClicks: increment(1),
        lastUpdated: new Date().toISOString()
      }, { merge: true }).catch(e => console.error("Error recording context free trial click", e));
    } catch (e) {
      console.error("Error recording free trial click", e);
    }
  };

  const handleUpdateFiliere = async () => {
    if (!currentUser || !tempSelection.filiere || !tempSelection.niveau) return;
    
    setLoginLoading(true);
    try {
      const userRef = doc(db, 'users', currentUser.username);
      await updateDoc(userRef, {
        filiere: tempSelection.filiere,
        niveau: tempSelection.niveau
      });
      
      const updatedUser = { 
        ...currentUser, 
        filiere: tempSelection.filiere, 
        niveau: tempSelection.niveau 
      };
      setCurrentUser(updatedUser);
      safeLocalStorage.setItem('ais_user', JSON.stringify(updatedUser));
      setShowFiliereSelection(false);
    } catch (err) {
      console.error("Error updating filiere:", err);
    } finally {
      setLoginLoading(false);
    }
  };

  const renderDemoFiliereSelection = () => {
    const demoOptions = [
      { id: 'IDE1', name: 'IDE 1', filiere: 'IDE', level: 'Niveau 1' },
      { id: 'IDE2', name: 'IDE 2', filiere: 'IDE', level: 'Niveau 2' },
      { id: 'IDE3', name: 'IDE 3', filiere: 'IDE', level: 'Niveau 3' },
      { id: 'TIM1', name: 'TIM 1', filiere: 'TIM', level: 'Niveau 1' },
      { id: 'TIM2', name: 'TIM 2', filiere: 'TIM', level: 'Niveau 2' }
    ];

    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-300">
          <div className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
                <Play className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 leading-tight">Choisissez votre filière</h3>
              <p className="text-sm text-gray-500 font-medium px-4">Sélectionnez la filière que vous souhaitez tester gratuitement</p>
            </div>

            <div className="space-y-3">
              {demoOptions.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleDemoAccess(opt.filiere, opt.level)}
                  className="w-full p-5 bg-gray-50 hover:bg-blue-50 border-2 border-transparent hover:border-blue-100 rounded-2xl text-left transition-all group flex items-center justify-between"
                >
                  <div className="flex flex-col">
                    <span className="font-black text-lg text-gray-900 group-hover:text-blue-700">{opt.name}</span>
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400 group-hover:text-blue-400">Accès Démo Gratuit</span>
                  </div>
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:bg-blue-600 transition-all">
                    <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-white" />
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowDemoFiliereSelection(false)}
              className="w-full py-4 text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest"
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderFiliereSelection = () => {
    const levels = tempSelection.filiere ? getLevelsForFiliere(tempSelection.filiere) : [];
    
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-4">
            <div className="w-24 h-24 mx-auto bg-blue-600 rounded-3xl flex items-center justify-center shadow-xl shadow-blue-200">
              <GraduationCap className="w-12 h-12 text-white" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-gray-900 tracking-tight">Configuration du profil</h2>
              <p className="text-gray-500 font-medium">Personnalisez votre expérience selon vos études</p>
            </div>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-gray-100 space-y-6 animate-in zoom-in-95 duration-300">
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-bold text-gray-700 ml-1">Filière d'études</label>
                <div className="grid grid-cols-1 gap-3">
                  {FILIERE_OPTIONS.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setTempSelection({ filiere: f.id, niveau: '' })}
                      className={cn(
                        "w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center justify-between group",
                        tempSelection.filiere === f.id ? "bg-blue-50 border-blue-500" : "bg-gray-50 border-gray-100 hover:border-blue-200"
                      )}
                    >
                      <span className={cn("font-bold text-lg", tempSelection.filiere === f.id ? "text-blue-700" : "text-gray-700 group-hover:text-blue-600")}>
                        {f.name}
                      </span>
                      {tempSelection.filiere === f.id && <CheckCircle2 className="w-6 h-6 text-blue-500 animate-in zoom-in" />}
                    </button>
                  ))}
                </div>
              </div>

              {tempSelection.filiere && (
                <div className="space-y-3 animate-in slide-in-from-top-4 duration-500">
                  <label className="text-sm font-bold text-gray-700 ml-1">Niveau actuel</label>
                  <div className="flex flex-wrap gap-2">
                    {levels.map(level => (
                      <button
                        key={level}
                        onClick={() => setTempSelection({ ...tempSelection, niveau: level })}
                        className={cn(
                          "px-4 py-3 rounded-xl border-2 font-bold transition-all",
                          tempSelection.niveau === level ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200" : "bg-gray-50 border-gray-100 text-gray-500 hover:bg-gray-100"
                        )}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleUpdateFiliere}
                disabled={!tempSelection.filiere || !tempSelection.niveau || loginLoading}
                className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loginLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <>Confirmer et continuer <ArrowRight className="w-5 h-5" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleUpdateUser = (updatedData: Partial<CustomUser>) => {
    if (!currentUser) return;
    const newUser = { ...currentUser, ...updatedData };
    setCurrentUser(newUser);
    safeLocalStorage.setItem('ais_user', JSON.stringify(newUser));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setIsAdmin(false);
    setUserRole('student');
    safeLocalStorage.removeItem('ais_user');
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gray-50 bg-dots transition-opacity duration-300">
        <div className="text-center space-y-4 p-8">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto" />
          <div className="space-y-1">
            <p className="text-lg font-bold text-gray-900">Synchronisation</p>
            <p className="text-gray-500 font-medium">Initialisation de Smart Tutor...</p>
          </div>
          
          <button 
            onClick={() => setIsAuthReady(true)}
            className="mt-8 text-sm text-blue-600 font-bold hover:underline"
          >
            Si le chargement est trop long, cliquez ici
          </button>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-gray-50 bg-dots p-4 transition-opacity duration-500">
        {showDemoFiliereSelection && renderDemoFiliereSelection()}
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-4">
            <div className="w-32 h-32 mx-auto mb-4 relative">
              <img 
                src="/logo.jpg" 
                alt="Smart Tutor Logo" 
                className="w-full h-full object-contain filter drop-shadow-[0_12px_24px_rgba(165,180,252,0.25)] rounded-2xl"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-black tracking-tight">
                <span className="bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-transparent">Smart Tutor</span>
              </h1>
              <p className="text-gray-500 font-medium">Plateforme d'apprentissage intelligente</p>
            </div>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-gray-100 space-y-6">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-gray-700 ml-1">Nom d'utilisateur</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={loginForm.username}
                    onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                    placeholder="Votre pseudo"
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-gray-700 ml-1">Mot de passe</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    required
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-col ml-1">
                  <label className="text-sm font-bold text-gray-700">Code Promo (Optionnel)</label>
                </div>
                <div className="relative">
                  <Star className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={loginForm.promoCode}
                    onChange={(e) => setLoginForm({ ...loginForm, promoCode: e.target.value })}
                    placeholder="Entrez votre code"
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium"
                  />
                </div>
              </div>

              {loginError && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-xl border border-red-100 animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-bold">{loginError}</p>
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50 flex items-center justify-center gap-2 text-lg"
                >
                  {loginLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Se connecter"}
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoAccess()}
                  className="w-full py-4 bg-white text-blue-600 border-2 border-blue-100 rounded-2xl font-bold hover:bg-blue-50 transition-all flex items-center justify-center gap-2 text-lg"
                >
                  <Play className="w-5 h-5" />
                  Tester gratuitement
                </button>

                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="w-full py-4 bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 border border-indigo-100 rounded-2xl font-black hover:from-indigo-100 hover:to-blue-100 transition-all flex items-center justify-center gap-2 text-base shadow-sm active:scale-95"
                >
                  <Download className="w-5 h-5 animate-bounce text-indigo-650" />
                  Installer l'application (PWA)
                </button>
              </div>
            </form>
          </div>
          
          <div className="text-center space-y-4">
            <a 
              href="https://wa.me/237698946202?text=Bonjour%2C%20j%27aimerais%20conna%C3%AEtre%20la%20proc%C3%A9dure%20pour%20obtenir%20mes%20identifiants%20Smart%20Tutor" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-6 py-4 bg-green-50 text-green-700 rounded-2xl border border-green-100 hover:bg-green-100 transition-all group"
            >
              <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-200 group-hover:scale-110 transition-transform">
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider opacity-70">Pas encore d'identifiants ?</p>
                <p className="text-sm font-black">Contactez-nous sur WhatsApp</p>
              </div>
            </a>
          </div>
        </div>
      </div>
      {!isPWAInstalled && (
        <button
          onClick={handleInstallClick}
          className="fixed bottom-4 right-4 z-[95] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-full px-4 py-2.5 shadow-xl border border-blue-500/10 flex items-center justify-center gap-2 group text-xs font-black tracking-wide active:scale-95 transition-all animate-pulse"
          style={{ animationDuration: '3s' }}
        >
          <Download className="w-4 h-4 text-white animate-bounce" style={{ animationDuration: '2s' }} />
          <span>Installer l'app</span>
        </button>
      )}
      {renderInstallInstructionsModal()}
      </>
    );
  }

  if (showFiliereSelection) {
    return renderFiliereSelection();
  }

  return (
    <>
      <div className="flex min-h-[100dvh] bg-gray-50 bg-dots flex-col md:flex-row overflow-y-auto items-stretch justify-start m-0 p-0">
      {showDemoFiliereSelection && renderDemoFiliereSelection()}
      {/* Offline Banner */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-orange-500 text-white py-2 px-4 flex items-center justify-center gap-2 animate-in slide-in-from-top duration-300">
          <WifiOff className="w-4 h-4" />
          <span className="text-sm font-bold">Vous êtes en mode hors ligne. Certaines fonctionnalités peuvent être limitées.</span>
        </div>
      )}

      {/* Install Banner */}
      {showInstallBanner && (deferredPrompt || isIOS) && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[92%] sm:w-full sm:max-w-md bg-white/95 backdrop-blur-md rounded-[2rem] sm:rounded-3xl shadow-2xl border border-blue-100 p-4 sm:p-5 flex items-center justify-between gap-3 sm:gap-4 animate-in slide-in-from-bottom-10 duration-500">
          <div className="flex items-center gap-3 sm:gap-4 overflow-hidden">
            <div className="w-11 h-11 sm:w-14 sm:h-14 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 shrink-0 overflow-hidden">
              <img src="/logo.jpg" alt="Smart Tutor Logo" className="w-8 h-8 sm:w-10 sm:h-10 object-contain rounded-md" referrerPolicy="no-referrer" />
            </div>
            <div className="min-w-0">
              <p className="font-black text-gray-900 text-base sm:text-lg leading-tight truncate">Smart Tutor</p>
              <p className="text-[10px] sm:text-sm text-gray-500 font-medium truncate">Installez l'app pour réviser partout</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button 
              onClick={handleInstallClick}
              className="bg-blue-600 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-1.5 sm:gap-2 shadow-md hover:shadow-lg active:scale-95 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Installer
            </button>
            <button 
              onClick={dismissInstallBanner}
              className="p-1.5 sm:p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg sm:rounded-xl transition-all"
            >
              <X className="w-5 h-5 sm:w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      {((location.pathname !== '/admin') || currentUser?.role === 'partner' || currentUser?.role === 'apporteur') && !isExamActive && (
        <Sidebar 
          isOpen={isSidebarOpen} 
          onClose={() => setIsSidebarOpen(false)} 
          isAdmin={isAdmin}
          onLogout={handleLogout}
          onInstall={handleInstallClick}
          onSwitchToPartnerSpace={(currentUser?.role === 'partner' || currentUser?.role === 'apporteur') ? () => {
            setPartnerWorkspaceMode('partner');
            safeLocalStorage.setItem('ais_partner_mode', 'partner');
            navigate('/');
          } : undefined}
        />
      )}
      
      <main className="flex-1 overflow-y-auto relative flex flex-col justify-start w-full h-auto max-h-[100vh]">
        <Routes>
          <Route path="/admin" element={isAdmin ? <AdminInterface onLogout={handleLogout} /> : <Navigate to="/" replace />} />
          {currentUser?.role === 'partner' && partnerWorkspaceMode === 'partner' ? (
            <>
              <Route path="/" element={<PartnerInterface onLogout={handleLogout} setIsSidebarOpen={setIsSidebarOpen} onEnterStudentSpace={(f) => {
                setCurrentPartnerFiliere(f);
                setPartnerWorkspaceMode('student');
                safeLocalStorage.setItem('ais_partner_mode', 'student');
                safeLocalStorage.setItem('ais_partner_filiere', f);
                navigate('/');
              }} />} />
              <Route path="/partner/*" element={<PartnerInterface onLogout={handleLogout} setIsSidebarOpen={setIsSidebarOpen} onEnterStudentSpace={(f) => {
                setCurrentPartnerFiliere(f);
                setPartnerWorkspaceMode('student');
                safeLocalStorage.setItem('ais_partner_mode', 'student');
                safeLocalStorage.setItem('ais_partner_filiere', f);
                navigate('/');
              }} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : currentUser?.role === 'apporteur' && partnerWorkspaceMode === 'partner' ? (
            <>
              <Route path="/" element={<BusinessIntroducerInterface onLogout={handleLogout} setIsSidebarOpen={setIsSidebarOpen} onEnterStudentSpace={(f) => {
                setCurrentPartnerFiliere(f);
                setPartnerWorkspaceMode('student');
                safeLocalStorage.setItem('ais_partner_mode', 'student');
                safeLocalStorage.setItem('ais_partner_filiere', f);
                navigate('/');
              }} />} />
              <Route path="/partner/*" element={<BusinessIntroducerInterface onLogout={handleLogout} setIsSidebarOpen={setIsSidebarOpen} onEnterStudentSpace={(f) => {
                setCurrentPartnerFiliere(f);
                setPartnerWorkspaceMode('student');
                safeLocalStorage.setItem('ais_partner_mode', 'student');
                safeLocalStorage.setItem('ais_partner_filiere', f);
                navigate('/');
              }} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <Route path="*" element={
              <UserInterface 
                user={(currentUser?.role === 'partner' || currentUser?.role === 'apporteur') ? { ...currentUser, filiere: currentPartnerFiliere || 'ECN' } : currentUser} 
                isSidebarOpen={isSidebarOpen} 
                setIsSidebarOpen={setIsSidebarOpen} 
                isAdmin={isAdmin} 
                onExamStateChange={setIsExamActive} 
                onLogout={handleLogout} 
                onUpdateUser={handleUpdateUser} 
                onSwitchToPartnerSpace={() => {
                  setPartnerWorkspaceMode('partner');
                  safeLocalStorage.setItem('ais_partner_mode', 'partner');
                  navigate('/');
                }}
              />
            } />
          )}
        </Routes>
      </main>
    </div>
    {!isPWAInstalled && !isExamActive && (
      <button
        onClick={handleInstallClick}
        className="fixed bottom-4 right-4 z-[95] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-full px-4 py-2.5 shadow-xl border border-blue-500/10 flex items-center justify-center gap-2 group text-xs font-black tracking-wide active:scale-95 transition-all animate-pulse"
        style={{ animationDuration: '3s' }}
      >
        <Download className="w-4 h-4 text-white animate-bounce" style={{ animationDuration: '2s' }} />
        <span>Installer l'app</span>
      </button>
    )}
    {renderInstallInstructionsModal()}
    </>
  );
}
