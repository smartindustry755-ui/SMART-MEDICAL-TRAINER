import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  Users, TrendingUp, Settings, LayoutGrid, Calendar, LogOut, 
  Key, ShieldAlert, CheckCircle, AlertCircle, Copy, Search,
  GraduationCap, Phone, Mail, Award, Clock, Loader2, Coins, ArrowRight, X, Menu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, query, onSnapshot, doc, updateDoc, 
  getDoc, getDocs, where 
} from 'firebase/firestore';
import { cn, safeLocalStorage } from '../lib/utils';
import { formatCurrency, DEFAULT_LICENSE_PARAMS, LicenseParams } from '../lib/finances';

interface UserProfile {
  id: string;
  username: string;
  password?: string;
  email?: string;
  role: 'admin' | 'student' | 'partner' | 'apporteur';
  displayName?: string;
  phone?: string;
  createdAt?: any;
  expiresAt?: any;
  filiere?: string;
  niveau?: string;
  promoCode?: string;
  partnerId?: string;
  hasLoggedIn?: boolean;
  status?: 'active' | 'suspended' | 'expired';
}

interface BusinessIntroducerInterfaceProps {
  onLogout: () => void;
  setIsSidebarOpen?: (open: boolean) => void;
  onEnterStudentSpace?: (filiere: string) => void;
}

export const APPORTEUR_FILIERES = [
  { id: 'ECN', name: 'Médecine (ECN)' },
  { id: 'IDE', name: 'Infirmier (IDE)' },
  { id: 'sage_femme', name: 'Sage-femme' },
  { id: 'kinetherapie', name: 'Kinésithérapie' },
  { id: 'pharmacie', name: 'Pharmacie' },
  { id: 'EM', name: 'Études Médicales (EM)' }
];

function NeumorphicCircularProgress({ percentage }: { percentage: number }) {
  const radius = 64;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center w-36 h-36 mx-auto select-none">
      {/* Outer soft shadow ring */}
      <div className="absolute inset-0 rounded-full bg-[#F4F7F6] shadow-[inset_6px_6px_12px_rgba(165,180,252,0.15),inset_-6px_-6px_12px_rgba(255,255,255,0.95)]" />
      
      {/* SVG Container */}
      <svg
        height={radius * 2}
        width={radius * 2}
        className="transform -rotate-90 relative z-10 w-32 h-32"
      >
        <defs>
          <linearGradient id="glowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        {/* Track circle */}
        <circle
          stroke="#E2E8F0"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className="opacity-40"
        />
        {/* Progress circle */}
        <circle
          stroke="url(#glowGrad)"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className="transition-all duration-500 ease-in-out"
        />
      </svg>
      
      {/* Inner raised circle */}
      <div className="absolute w-20 h-20 rounded-full bg-[#F4F7F6] shadow-[4px_4px_10px_rgba(15,23,42,0.06),-4px_-4px_10px_rgba(255,255,255,0.95)] flex flex-col items-center justify-center z-20">
        <span className="text-xl font-black tracking-tight text-indigo-950 font-sans">{percentage}%</span>
        <span className="text-[9px] font-black text-indigo-650 uppercase tracking-widest font-mono">Actifs</span>
      </div>
    </div>
  );
}

export default function BusinessIntroducerInterface({ onLogout, setIsSidebarOpen, onEnterStudentSpace }: BusinessIntroducerInterfaceProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const savedUser = safeLocalStorage.getItem('ais_user');
  const user = savedUser ? JSON.parse(savedUser) : null;

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'finances' | 'profile'>('dashboard');
  const [globalCurrency, setGlobalCurrency] = useState('XOF');

  const [apporteurProfile, setApporteurProfile] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transLoading, setTransLoading] = useState(true);
  const [licenseParamsList, setLicenseParamsList] = useState<LicenseParams[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [dbFilieres, setDbFilieres] = useState<{ id: string; name: string }[]>([]);

  const profileConfig = apporteurProfile || user;
  const promoCodeRaw = (profileConfig?.promoCode || '').toUpperCase().trim();

  // Profile Form state
  const [profileForm, setProfileForm] = useState({
    displayName: user?.displayName || '',
    phone: user?.phone || '',
    email: user?.email || '',
  });
  const [editLoading, setEditLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    
    // Subscribe to currency settings
    const unsubCurrency = onSnapshot(doc(db, 'settings', 'financialSettings'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().currency) {
        setGlobalCurrency(docSnap.data().currency);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'settings/financialSettings');
    });

    // Subscribe to apporteur's live DB document
    const docRef = doc(db, 'users', user.id || user.username);
    const unsubProfile = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setApporteurProfile(data);
        setProfileForm({
          displayName: data.displayName || '',
          phone: data.phone || '',
          email: data.email || '',
        });
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${user.id || user.username}`);
    });

    // Fetch users (used to link with their code)
    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'users');
      setLoading(false);
    });

    // Subscribe to Financial History
    const qTrans = query(collection(db, 'financialHistory'));
    const unsubTrans = onSnapshot(qTrans, (snap) => {
      setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTransLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'financialHistory');
      setTransLoading(false);
    });

    // Subscribe to license parameters
    const qParams = query(collection(db, 'licenseParams'));
    const unsubParams = onSnapshot(qParams, (snap) => {
      const data: LicenseParams[] = [];
      const existingIds = new Set<string>();
      snap.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as LicenseParams);
        existingIds.add(doc.id);
      });
      // Fallback defaults
      Object.entries(DEFAULT_LICENSE_PARAMS).forEach(([id, fallback]) => {
        if (!existingIds.has(id)) {
          data.push({ id, ...fallback } as LicenseParams);
        }
      });
      setLicenseParamsList(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'licenseParams');
    });

    // Subscribe to apporteur specific payouts (expenses registered for him)
    const qExp = query(collection(db, 'expenses'), where('partnerId', '==', user?.id || user?.username || ''));
    const unsubExp = onSnapshot(qExp, (snap) => {
      setPayouts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'expenses');
    });

    // Subscribe to active filieres
    const unsubFilieres = onSnapshot(collection(db, 'filieres'), (snap) => {
      const list: any[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.status === 'active' || !data.status) {
          list.push({ id: docSnap.id, name: data.name || docSnap.id });
        }
      });
      setDbFilieres(list);
    }, (err) => {
      console.warn("Could not fetch filieres of business introducer:", err);
    });

    return () => {
      unsubCurrency();
      unsubProfile();
      unsubUsers();
      unsubTrans();
      unsubParams();
      unsubExp();
      unsubFilieres();
    };
  }, [user?.id, user?.username]);

  // Tab switching from location
  useEffect(() => {
    const path = location.pathname;
    if (path === '/' || path === '/partner' || path === '/partner/dashboard') {
      setActiveTab('dashboard');
    } else if (path === '/partner/finances') {
      setActiveTab('finances');
    } else if (path === '/partner/profile') {
      setActiveTab('profile');
    }
  }, [location.pathname]);

  if (!user || user.role !== 'apporteur') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full text-center space-y-4 p-8 bg-white rounded-3xl shadow-xl border border-gray-100">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-2xl font-black text-gray-900 leading-tight">Accès réservé</h2>
          <p className="text-gray-500 text-sm font-medium">Vous devez posséder un compte Apporteur d'Affaires actif pour accéder à cet espace.</p>
          <button 
            onClick={onLogout}
            className="px-6 py-2.5 bg-red-600 font-bold text-white text-xs rounded-xl hover:bg-red-700 transition"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  const activeFilieresList = dbFilieres.length > 0 ? dbFilieres : APPORTEUR_FILIERES;
  const allowedFils = profileConfig?.allowedFilieres || [];
  const visibleFilieres = activeFilieresList.filter(f => allowedFils.includes(f.id));

  const cleanPromoString = (s: string) => {
    return (s || '')
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };

  const cleanPromoCode = cleanPromoString(promoCodeRaw);

  // Strictly filter users attached to their promotional code
  const promoSubscribers = users.filter(u => {
    if (u.role !== 'student') return false;
    return !!(cleanPromoCode && u.promoCode && cleanPromoString(u.promoCode) === cleanPromoCode);
  });

  const getStudentFinanceDetails = (u: UserProfile) => {
    const filId = (u.filiere || 'ECN').toUpperCase().trim();
    const lic = licenseParamsList.find(p => p.id.toUpperCase().trim() === filId)
                || { 
                     id: filId, 
                     name: filId, 
                     price3m: 30, price6m: 50, price12m: 80, 
                     promoCommission: 10, partnerCommission: 15, 
                     status: 'active',
                     ...(DEFAULT_LICENSE_PARAMS[filId] || DEFAULT_LICENSE_PARAMS.ALL) 
                   };
    
    let approxMonths = 3;
    if (u.expiresAt) {
      const created = u.createdAt?.toDate ? u.createdAt.toDate() : (u.createdAt ? new Date(u.createdAt) : null);
      const expires = u.expiresAt.toDate ? u.expiresAt.toDate() : new Date(u.expiresAt);
      if (created) {
        const diffMs = expires.getTime() - created.getTime();
        const computed = diffMs / (1000 * 60 * 60 * 24 * 30.43);
        if (computed > 9) approxMonths = 12;
        else if (computed > 4.5) approxMonths = 6;
        else approxMonths = 3;
      } else {
        approxMonths = 12;
      }
    }

    let price = lic.price3m;
    if (approxMonths === 6) price = lic.price6m;
    else if (approxMonths === 12) price = lic.price12m;

    const promoPct = lic.promoCommission ?? 10;
    const commissionPromo = Math.round((price * (promoPct / 100)) * 100) / 100;

    return {
      price,
      commissionPromo,
      ratePromo: promoPct,
      approxMonths,
      licName: lic.name || lic.id
    };
  };

  const calculateDaysRemaining = (expiryDate: any) => {
    if (!expiryDate) return 'Illimité';
    const date = expiryDate.toDate ? expiryDate.toDate() : new Date(expiryDate);
    const diff = date.getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  };

  const isStudentActive = (u: UserProfile) => {
    if (u.status === 'suspended') return false;
    const days = calculateDaysRemaining(u.expiresAt);
    if (days !== 'Illimité' && typeof days === 'number' && days <= 0) return false;
    return true;
  };

  const activeStudents = promoSubscribers.filter(isStudentActive);
  const expiredStudents = promoSubscribers.filter(u => !isStudentActive(u));

  // Build resolved transactions by mapping mapped/parrained students
  const resolvedTrans = promoSubscribers.map(st => {
    const foundReal = transactions.find(t => {
      const isUserMatch = (t.userId && (t.userId === st.id || t.userId === st.username)) || 
                          (t.username && (t.username === st.id || t.username === st.username));
      return isUserMatch;
    });

    const filId = (st.filiere || 'ECN').toUpperCase().trim();
    const lic = licenseParamsList.find(p => p.id.toUpperCase().trim() === filId)
                || { promoCommission: 10 };
    const promoPct = lic.promoCommission ?? 10;

    if (foundReal) {
      const realPrice = Number(foundReal.amountPaid) || 0;
      const comPromo = Math.round((realPrice * (promoPct / 100)) * 100) / 100;

      return {
        ...foundReal,
        amountPaid: realPrice,
        commissionPromo: comPromo,
        userDisplayName: foundReal.userDisplayName || st.displayName || st.username,
        licenseName: foundReal.licenseName || st.filiere || 'Abonnement Standard'
      };
    }

    const finDetails = getStudentFinanceDetails(st);

    return {
      id: `virtual-${st.id}`,
      date: st.createdAt || null,
      userId: st.id,
      username: st.username,
      userDisplayName: st.displayName || st.username,
      licenseId: st.filiere || 'ECN',
      licenseName: finDetails.licName,
      amountPaid: finDetails.price,
      promoCode: st.promoCode || '',
      commissionPromo: finDetails.commissionPromo,
      ratePromo: finDetails.ratePromo,
      status: 'paid' as const
    };
  });

  // Keep any other real transactions matching this promo code
  const unmappedRealTrans = transactions.filter(t => {
    const codeMatch = cleanPromoCode && t.promoCode && cleanPromoString(t.promoCode) === cleanPromoCode;
    const isAlreadyResolved = resolvedTrans.some(rt => rt.id === t.id);
    return codeMatch && !isAlreadyResolved;
  });

  const mappedUnmappedRealTrans = unmappedRealTrans.map(t => {
    const matchedStudent = users.find(u => u.id === t.userId || u.username === t.userId);
    const filId = (t.licenseId || (matchedStudent && matchedStudent.filiere) || 'ECN').toUpperCase().trim();
    const lic = licenseParamsList.find(p => p.id.toUpperCase().trim() === filId)
                || { promoCommission: 10 };
    const promoPct = lic.promoCommission ?? 10;
    const realPrice = Number(t.amountPaid) || 0;
    const comPromo = Math.round((realPrice * (promoPct / 100)) * 100) / 100;

    return {
      ...t,
      amountPaid: realPrice,
      commissionPromo: comPromo,
      userDisplayName: t.userDisplayName || (matchedStudent && matchedStudent.displayName) || t.username || 'Abonné',
    };
  });

  const allPromoTrans = [...resolvedTrans, ...mappedUnmappedRealTrans];
  const paidTrans = allPromoTrans.filter(t => t.status === 'paid');

  // Money accumulation (Promo percents part ONLY)
  const totalGainsCumules = paidTrans.reduce((sum, t) => sum + (Number(t.commissionPromo) || 0), 0);
  const totalPayoutsReceived = payouts.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const remainingBalance = Math.max(0, totalGainsCumules - totalPayoutsReceived);

  // Inscriptions this month
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthlyInscriptions = promoSubscribers.filter(u => {
    if (!u.createdAt) return false;
    const date = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  });

  const handleCopyPromo = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditLoading(true);
    setStatusMessage(null);
    try {
      const userRef = doc(db, 'users', user.username);
      await updateDoc(userRef, {
        displayName: profileForm.displayName,
        phone: profileForm.phone,
        email: profileForm.email
      });

      const updatedUser = { 
        ...user, 
        displayName: profileForm.displayName,
        phone: profileForm.phone,
        email: profileForm.email 
      };
      safeLocalStorage.setItem('ais_user', JSON.stringify(updatedUser));
      setApporteurProfile(updatedUser);
      setStatusMessage({ type: 'success', text: 'Profil mis à jour avec succès !' });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Une erreur est survenue lors de la modification.' });
    } finally {
      setEditLoading(false);
    }
  };

  // Searching users
  const filteredPromoSubscribers = promoSubscribers.filter(u => {
    const searchLow = searchTerm.toLowerCase();
    const matchesName = u.displayName?.toLowerCase().includes(searchLow);
    const matchesUsername = u.username?.toLowerCase().includes(searchLow);
    const matchesFiliere = u.filiere?.toLowerCase().includes(searchLow);
    return matchesName || matchesUsername || matchesFiliere;
  });

  const handleNavigateTo = (tab: 'dashboard' | 'finances' | 'profile', path: string) => {
    setActiveTab(tab);
    navigate(path);
  };

  return (
    <div className="min-h-screen bg-[#F4F7F6] text-slate-800 p-4 sm:p-8 space-y-8 max-w-7xl mx-auto w-full rounded-[32px] shadow-[12px_12px_36px_rgba(165,180,252,0.15),-12px_-12px_36px_rgba(255,255,255,0.95)]">
      {/* Upper header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-gray-100/50">
        <div className="flex items-center gap-4">
          {setIsSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-3 bg-[#F4F7F6] hover:bg-gray-100/40 rounded-2xl shadow-[4px_4px_10px_rgba(165,180,252,0.15),-4px_-4px_10px_rgba(255,255,255,0.95)] text-gray-500 transition mr-1 shrink-0 active:scale-95"
              title="Ouvrir le menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <div>
            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest font-mono bg-indigo-50/60 px-2.5 py-1 rounded-full shadow-xs">
              Espace Apporteur d'Affaires
            </span>
            <h1 className="text-3xl font-black text-gray-950 tracking-tight leading-none mt-2">
              Bonjour, <span className="bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-transparent font-black">{user.displayName || user.username}</span>
            </h1>
            <p className="text-xs text-gray-500 font-bold mt-1.5">Gérez vos liens de parrainage et suivez vos gains accumulés en temps réel.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full md:w-auto">
          {promoCodeRaw && (
            <div className="bg-[#F4F7F6] rounded-3xl p-4 flex items-center gap-4 shadow-[6px_6px_18px_rgba(165,180,252,0.16),-6px_-6px_18px_rgba(255,255,255,0.95)] max-w-sm w-full sm:w-auto">
              <div>
                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest font-mono">Votre code Promo</p>
                <p className="text-lg font-black bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-transparent tracking-wider font-mono">{promoCodeRaw}</p>
              </div>
              <button 
                onClick={() => handleCopyPromo(promoCodeRaw)}
                className="ml-auto p-2.5 bg-[#F4F7F6] text-indigo-600 shadow-[4px_4px_10px_rgba(165,180,252,0.14),-4px_-4px_10px_rgba(255,255,255,0.95)] hover:shadow-[inset_2px_2px_6px_rgba(165,180,252,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] rounded-2xl transition-all duration-200 active:scale-95 flex items-center justify-center"
                title="Copier le code"
              >
                {copied ? <CheckCircle className="w-4 h-4 text-green-600 animate-in zoom-in" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          )}

          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 px-6 py-3.5 bg-[#F4F7F6] hover:bg-red-50/20 text-red-650 font-black text-xs rounded-full shadow-[4px_4px_12px_rgba(239,68,68,0.12),-4px_-4px_12px_rgba(255,255,255,0.95)] hover:shadow-[inset_2px_2px_6px_rgba(239,68,68,0.06),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] transition-all active:scale-95 self-end sm:self-auto uppercase tracking-wider"
            title="Se déconnecter"
          >
            <LogOut className="w-4 h-4" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      {!loading && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100/50">
          <div className="bg-[#F4F7F6] p-1.5 rounded-full shadow-[inset_3px_3px_8px_rgba(165,180,252,0.12),inset_-3px_-3px_8px_rgba(255,255,255,0.95)] flex items-center gap-1.5 overflow-x-auto scrollbar-none max-w-full">
            <button
              onClick={() => handleNavigateTo('dashboard', '/partner/dashboard')}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-xs font-black rounded-full transition-all duration-300 shrink-0",
                activeTab === 'dashboard'
                  ? "bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-[0_6px_15px_rgba(37,99,235,0.25)]"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Tableau de Bord</span>
            </button>

            <button
              onClick={() => handleNavigateTo('finances', '/partner/finances')}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-xs font-black rounded-full transition-all duration-300 shrink-0",
                activeTab === 'finances'
                  ? "bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-[0_6px_15px_rgba(37,99,235,0.25)]"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <Coins className="w-4 h-4" />
              <span>Mes Finances</span>
            </button>

            <button
              onClick={() => handleNavigateTo('profile', '/partner/profile')}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-xs font-black rounded-full transition-all duration-300 shrink-0",
                activeTab === 'profile'
                  ? "bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-[0_6px_15px_rgba(37,99,235,0.25)]"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <Settings className="w-4 h-4" />
              <span>Mon Profil</span>
            </button>
          </div>

          <button
            onClick={onLogout}
            className="hidden sm:flex items-center justify-center gap-2 px-5 py-2.5 bg-[#F4F7F6] hover:bg-red-50/20 text-red-600 font-bold text-xs rounded-full shadow-[3px_3px_8px_rgba(239,68,68,0.1),-3px_-3px_8px_rgba(255,255,255,0.95)] transition active:scale-95 shrink-0"
          >
            <LogOut className="w-4 h-4" />
            <span>Fermer la session</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="h-96 flex flex-col items-center justify-center gap-3 bg-[#F4F7F6] rounded-[32px] shadow-[inset_4px_4px_10px_rgba(165,180,252,0.1)]">
          <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          <p className="text-sm text-gray-400 font-bold">Chargement des données de l'apporteur...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              {/* Core metrics matching Apporteur scale */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-[#F4F7F6] rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] flex items-center gap-4 transition-all duration-300 hover:scale-[1.01]">
                  <div className="p-4 bg-[#F4F7F6] text-blue-600 rounded-2xl shadow-[inset_3px_3px_6px_rgba(165,180,252,0.15),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest font-mono">Mes Abonnés Rattachés</p>
                    <p className="text-2xl font-black text-gray-900 mt-0.5">{promoSubscribers.length}</p>
                  </div>
                </div>

                <div className="bg-[#F4F7F6] rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] flex items-center gap-4 transition-all duration-300 hover:scale-[1.01]">
                  <div className="p-4 bg-[#F4F7F6] text-emerald-600 rounded-2xl shadow-[inset_3px_3px_6px_rgba(165,180,252,0.15),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]">
                    <CheckCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest font-mono">Abonnés Actifs</p>
                    <p className="text-2xl font-black text-gray-900 mt-0.5">{activeStudents.length}</p>
                  </div>
                </div>

                <div className="bg-[#F4F7F6] rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] flex items-center gap-4 transition-all duration-300 hover:scale-[1.01]">
                  <div className="p-4 bg-[#F4F7F6] text-purple-600 rounded-2xl shadow-[inset_3px_3px_6px_rgba(165,180,252,0.15),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]">
                    <Coins className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest font-mono">Mes Commissions Cumulées</p>
                    <p className="text-xl font-black text-indigo-950 font-mono mt-0.5">{formatCurrency(totalGainsCumules, globalCurrency)}</p>
                  </div>
                </div>

                <div className="bg-[#F4F7F6] rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] flex items-center gap-4 transition-all duration-300 hover:scale-[1.01]">
                  <div className="p-4 bg-[#F4F7F6] text-indigo-650 rounded-2xl shadow-[inset_3px_3px_6px_rgba(165,180,252,0.15),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest font-mono">Rattachés ce mois</p>
                    <p className="text-2xl font-black text-gray-900 mt-0.5">{monthlyInscriptions.length}</p>
                  </div>
                </div>
              </div>

              {/* ACCÈS AUX TABLEAUX DE BORD DE L'APPLICATION (Student space / simulators) */}
              <div className="bg-[#F4F7F6] rounded-[32px] p-6 sm:p-8 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] space-y-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-indigo-600 animate-bounce" />
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest font-mono bg-indigo-50/60 px-2.5 py-1 rounded-full shadow-xs">Simulations & QCM</span>
                  </div>
                  <h3 className="text-xl font-black text-gray-950 tracking-tight mt-2">Accéder aux Tableaux de Bord de l'Application</h3>
                  <p className="text-xs text-gray-500 font-bold leading-relaxed max-w-3xl">
                    Découvrez en direct l'interface étudiante et le parcours d'apprentissage complet de la plateforme. Lancez des révisions interactives, testez les fiches de compétences et observez le contenu académique auquel votre code donne accès.
                  </p>
                </div>

                {visibleFilieres.length === 0 ? (
                  <div className="text-center py-10 bg-[#F4F7F6] shadow-[inset_4px_4px_10px_rgba(165,180,252,0.1),inset_-4px_-4px_10px_rgba(255,255,255,0.95)] rounded-3xl p-6">
                    <ShieldAlert className="w-10 h-10 text-indigo-400 mx-auto mb-2 animate-pulse" />
                    <p className="text-xs font-black text-gray-500 uppercase tracking-widest font-mono">Aucune filière autorisée</p>
                    <p className="text-[11px] text-gray-400 font-semibold mt-1 max-w-sm mx-auto">Veuillez demander à l'administrateur de vous attribuer les accès de visite pour les filières souhaitées.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 pt-2">
                    {visibleFilieres.map((fil) => (
                      <button
                        key={fil.id}
                        onClick={() => onEnterStudentSpace && onEnterStudentSpace(fil.id)}
                        className="flex items-center justify-between p-5 bg-[#F4F7F6] shadow-[5px_5px_15px_rgba(165,180,252,0.14),-5px_-5px_15px_rgba(255,255,255,0.95)] hover:shadow-[inset_2px_2px_6px_rgba(165,180,252,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] rounded-[24px] group text-left cursor-pointer transition-all duration-300 transform hover:scale-[1.01]"
                      >
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest font-mono block">Tester l'espace</span>
                          <span className="text-sm font-black text-gray-950 group-hover:text-indigo-900 transition">{fil.name}</span>
                        </div>
                        <div className="w-10 h-10 bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-[0_4px_10px_rgba(37,99,235,0.3)] rounded-2xl flex items-center justify-center transition-all duration-300">
                          <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Promo section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gradient-to-br from-[#2563EB] via-[#4F46E5] to-[#7C3AED] p-8 rounded-[32px] text-white shadow-[0_12px_28px_rgba(37,99,235,0.3)] flex flex-col justify-between hover:shadow-[0_16px_32px_rgba(37,99,235,0.35)] transition duration-300 min-h-[220px]">
                  <div>
                    <Award className="w-8 h-8 text-indigo-200 mb-4" />
                    <h3 className="text-lg font-black tracking-tight mb-2 uppercase">Code Parrainage Exclusif</h3>
                    <p className="text-xs text-white/80 leading-relaxed font-semibold">Toute personne s'inscrivant avec ce code est rattachée à vous, générant automatiquement votre pourcentage sur chaque transaction d'achat de licence.</p>
                  </div>
                  
                  <div className="mt-6 flex items-center justify-between bg-white/10 px-4 py-3 rounded-2xl border border-white/10">
                    <span className="font-mono text-sm tracking-wider uppercase font-black text-indigo-100">{promoCodeRaw || 'AUCUN'}</span>
                    <button 
                      onClick={() => promoCodeRaw && handleCopyPromo(promoCodeRaw)}
                      className="text-xs font-black bg-white text-indigo-950 px-5 py-2 rounded-full hover:bg-slate-100 transition active:scale-95 shadow-md uppercase tracking-wider"
                    >
                      Copier
                    </button>
                  </div>
                </div>

                <div className="bg-[#F4F7F6] rounded-[32px] p-8 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] flex flex-col md:flex-row items-center justify-between gap-6 min-h-[220px]">
                  <div className="space-y-3 max-w-xs text-center md:text-left">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest font-mono bg-gray-200/50 px-2.5 py-1 rounded-full">
                      Performance Mensuelle
                    </span>
                    <h3 className="text-lg font-black text-gray-950 tracking-tight mt-2">Rejoignants de ce mois</h3>
                    <p className="text-xs text-gray-400 leading-relaxed font-semibold">Suivez l'efficacité commerciale de votre promotion pour le mois de {now.toLocaleDateString('fr-FR', { month: 'long' })}.</p>
                    
                    <div className="pt-2">
                      <button 
                        onClick={() => handleNavigateTo('finances', '/partner/finances')}
                        className="text-xs font-black text-indigo-650 hover:text-[#2563EB] tracking-wide inline-flex items-center gap-1 hover:underline"
                      >
                        Consulter mon solde <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <NeumorphicCircularProgress 
                      percentage={promoSubscribers.length > 0 ? Math.round((activeStudents.length / promoSubscribers.length) * 100) : 0} 
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FINANCES */}
          {activeTab === 'finances' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black text-gray-950 leading-tight">Relevé Financier Partagé</h3>
                  <p className="text-gray-500 text-xs font-bold mt-1.5">
                    Visualisez uniquement les affiliés rattachés à votre code promo <span className="font-mono text-indigo-700 bg-indigo-50/70 px-1.5 py-0.5 rounded-lg border border-indigo-100">[{promoCodeRaw}]</span> et l'argent cumulé correspond à vos pourcentages.
                  </p>
                </div>
                <div className="bg-[#F4F7F6] shadow-[4px_4px_12px_rgba(165,180,252,0.15),-4px_-4px_12px_rgba(255,255,255,0.95)] rounded-2xl px-5 py-3 flex items-center gap-3 shrink-0">
                  <Coins className="w-5 h-5 text-[#2563EB]" />
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-widest font-black leading-none font-mono">Commission cumulative</p>
                    <p className="text-sm font-black text-indigo-950 mt-1 font-mono">{formatCurrency(totalGainsCumules, globalCurrency)}</p>
                  </div>
                </div>
              </div>

              {/* Financial metric counts for Apporteur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-[#F4F7F6] rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] border-0 transition-all duration-300 hover:scale-[1.01]">
                  <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block font-mono">Affiliés payants</span>
                  <span className="text-2xl font-black text-gray-950 block mt-1">{paidTrans.length}</span>
                  <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md font-bold mt-3 inline-block">Licences confirmées</span>
                </div>

                <div className="bg-[#F4F7F6] rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] border-0 transition-all duration-300 hover:scale-[1.01]">
                  <span className="text-[10px] text-indigo-500 font-black uppercase tracking-widest block font-mono">Mon Pourcentage Cumulé (Total)</span>
                  <span className="text-2xl font-black text-indigo-650 block mt-1 font-mono">{formatCurrency(totalGainsCumules, globalCurrency)}</span>
                  <span className="text-[10px] text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md font-bold mt-3 inline-block font-mono">Commission acquise</span>
                </div>

                <div className="bg-[#F4F7F6] rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] border-0 transition-all duration-300 hover:scale-[1.01]">
                  <span className="text-[10px] text-rose-500 font-black uppercase tracking-widest block font-mono">Règlements Reçus (Retraits)</span>
                  <span className="text-2xl font-black text-rose-600 block mt-1 font-mono">{formatCurrency(totalPayoutsReceived, globalCurrency)}</span>
                  <span className="text-[10px] text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md font-bold mt-3 inline-block font-mono">Versé par l'administration</span>
                </div>

                <div className="bg-gradient-to-br from-white/40 to-emerald-50/30 rounded-[24px] p-6 shadow-[8px_8px_24px_rgba(16,185,129,0.13),-8px_-8px_24px_rgba(255,255,255,0.95)] border border-emerald-100 transition-all duration-300 hover:scale-[1.01]">
                  <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest block font-mono">Solde Restant à Toucher</span>
                  <span className="text-2xl font-black text-emerald-700 block mt-1 font-mono">{formatCurrency(remainingBalance, globalCurrency)}</span>
                  <span className="text-[10px] text-emerald-800 bg-emerald-100/50 px-2.5 py-1 rounded-md font-black mt-3 inline-block font-mono">Avoir disponible</span>
                </div>
              </div>

              {/* Transactions filtered exclusively by promo code */}
              <div className="bg-[#F4F7F6] rounded-[32px] p-6 sm:p-8 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 pb-2">
                  <h3 className="text-lg font-black text-gray-950 tracking-tight">Historique des ventes / abonnés parrainés</h3>
                  <div className="relative max-w-sm w-full">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Rechercher par nom ou login..."
                      className="w-full pl-10 pr-4 py-3 text-xs bg-[#F4F7F6] border-none shadow-[inset_3px_3px_6px_rgba(165,180,252,0.14),inset_-3px_-3px_6px_rgba(255,255,255,0.9)] focus:ring-2 focus:ring-[#2563EB]/45 outline-none rounded-2xl transition-all duration-300 font-bold"
                    />
                  </div>
                </div>

                {paidTrans.length === 0 ? (
                  <div className="py-12 text-center bg-[#F4F7F6] shadow-[inset_3px_3px_8px_rgba(165,180,252,0.08),inset_-3px_-3px_8px_rgba(255,255,255,0.9)] rounded-[24px] text-sm text-gray-400 font-bold italic">
                    Aucun abonnement payant n'a été rattaché à ce code promo pour le moment.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-3xl bg-[#F4F7F6] shadow-[inset_4px_4px_10px_rgba(165,180,252,0.08),inset_-4px_-4px_10px_rgba(255,255,255,0.9)] p-2">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="text-[10px] font-black text-gray-500 uppercase tracking-widest select-none bg-indigo-50/10">
                          <th className="py-4 px-5">Affilié</th>
                          <th className="py-4 px-5">Abonnement / Licence</th>
                          <th className="py-4 px-5">Date de début</th>
                          <th className="py-4 px-5 text-center">Montant d'achat</th>
                          <th className="py-4 px-5 text-center">Taux Comm. Code</th>
                          <th className="py-4 px-5 text-right">Votre Commission</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100/50 text-xs font-bold text-gray-700">
                        {paidTrans
                          .filter(t => {
                            if (!searchTerm) return true;
                            const term = searchTerm.toLowerCase();
                            return t.userDisplayName?.toLowerCase().includes(term) || 
                                   t.username?.toLowerCase().includes(term);
                          })
                          .map((t, idx) => {
                            // Find active / passive licence configuration for this licenseId
                            const filParams = licenseParamsList.find(p => p.id === t.licenseId);
                            const activePct = filParams?.promoCommission ?? t.ratePromo ?? 10;
                            return (
                              <tr key={t.id || idx} className="hover:bg-white/20 transition-all duration-200">
                                <td className="py-4 px-5">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-2xl bg-[#F4F7F6] shadow-[3px_3px_8px_rgba(165,180,252,0.12),-3px_-3px_8px_rgba(255,255,255,0.95)] text-indigo-650 font-black text-xs flex items-center justify-center border border-white/40">
                                      {t.userDisplayName?.[0]?.toUpperCase() || t.username?.[0]?.toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="font-black text-gray-950">{t.userDisplayName || t.username}</p>
                                      <p className="text-[10px] text-gray-400 font-mono">@{t.username}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-4 px-5">
                                  <span className="bg-[#F4F7F6] shadow-[2px_2px_5px_rgba(165,180,252,0.1),-2px_-2px_5px_rgba(255,255,255,0.95)] px-3 py-1.5 rounded-xl text-[10px] text-indigo-750 font-black uppercase tracking-wider border border-white/50">{t.licenseName || t.licenseId || 'Standard'}</span>
                                </td>
                                <td className="py-4 px-5 text-gray-500 font-bold">
                                  {t.date ? (
                                    t.date?.toDate ? t.date.toDate().toLocaleDateString('fr-FR') : new Date(t.date).toLocaleDateString('fr-FR')
                                  ) : 'Indéterminée'}
                                </td>
                                <td className="py-4 px-5 text-center font-mono text-gray-800 font-bold">
                                  {formatCurrency(t.amountPaid, globalCurrency)}
                                </td>
                                <td className="py-4 px-5 text-center">
                                  <span className="px-2.5 py-1 bg-[#F4F7F6] shadow-[inset_1.5px_1.5px_3px_rgba(165,180,252,0.1),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] rounded-lg text-indigo-650 font-black text-[10px] font-mono">
                                    {activePct}%
                                  </span>
                                </td>
                                <td className="py-4 px-5 text-right font-black text-emerald-700 font-mono text-sm">
                                  {formatCurrency(t.commissionPromo, globalCurrency)}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Payouts list for Apporteur */}
              <div className="bg-[#F4F7F6] rounded-[32px] p-6 sm:p-8 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] space-y-6">
                <h3 className="text-base font-black text-gray-950 pb-2 tracking-tight uppercase">Historique de vos Reversements (Reçus)</h3>
                {payouts.length === 0 ? (
                  <p className="text-xs text-gray-400 font-bold italic text-center py-8 bg-[#F4F7F6] shadow-[inset_3px_3px_6px_rgba(190,24,74,0.04),inset_-3px_-3px_6px_rgba(255,255,255,0.9)] rounded-[24px]">
                    Aucun virement d'honoraires n'a encore été reversé pour votre compte promo.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-3xl bg-[#F4F7F6] shadow-[inset_4px_4px_10px_rgba(165,180,252,0.08),inset_-4px_-4px_10px_rgba(255,255,255,0.9)] p-2">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          <th className="py-4 px-5">Motif du réglement</th>
                          <th className="py-4 px-5">Date de payement</th>
                          <th className="py-4 px-5 text-right">Somme perçue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100/50 text-xs font-bold text-gray-700">
                        {payouts.map(exp => (
                          <tr key={exp.id} className="hover:bg-white/10 transition-all duration-200">
                            <td className="py-4 px-5 flex items-center gap-3">
                              <span className="px-3 py-1.5 bg-[#F4F7F6] shadow-[2px_2px_5px_rgba(225,29,72,0.06),-2px_-2px_5px_rgba(255,255,255,0.95)] text-rose-700 rounded-xl font-black text-[10px] uppercase border border-rose-100/10">Réglement direct</span>
                              <span className="text-xs text-gray-600 font-bold ml-2">{exp.description || 'Paiement de commission commission promo'}</span>
                            </td>
                            <td className="py-3 px-4 text-gray-500 font-mono">
                              {exp.date ? (
                                exp.date?.toDate ? exp.date.toDate().toLocaleDateString('fr-FR') : new Date(exp.date).toLocaleDateString('fr-FR')
                              ) : 'N/A'}
                            </td>
                            <td className="py-3 px-5 text-right text-rose-600 font-black font-mono">
                              -{formatCurrency(Number(exp.amount) || 0, globalCurrency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: PROFILE */}
          {activeTab === 'profile' && (
            <div className="max-w-2xl mx-auto bg-[#F4F7F6] rounded-[32px] p-6 sm:p-8 shadow-[8px_8px_24px_rgba(165,180,252,0.18),-8px_-8px_24px_rgba(255,255,255,0.95)] space-y-6 animate-in fade-in duration-300">
              <div>
                <h3 className="text-xl font-black text-gray-950 tracking-tight">Paramètres de mon Profil</h3>
                <p className="text-xs text-gray-400 font-bold mt-1">Mettez à jour vos informations de contact enregistrées pour les rapports d'activity.</p>
              </div>

              {statusMessage && (
                <div className={cn(
                  "p-4 rounded-2xl flex items-center gap-3 text-xs font-bold border animate-in slide-in-from-top-2",
                  statusMessage.type === 'success' ? "bg-green-50 border-green-150 text-green-700 font-bold animate-pulse" : "bg-red-50 border-red-150 text-red-700"
                )}>
                  {statusMessage.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                  <span>{statusMessage.text}</span>
                </div>
              )}

              <form onSubmit={handleUpdateProfile} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="space-y-1.5 animate-in fade-in">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider ml-1">Identifiant Unique (Non modifiable)</label>
                    <input 
                      type="text"
                      value={user.username}
                      disabled
                      className="w-full px-4 py-3 bg-[#F4F7F6]/60 border-none shadow-[inset_1.5px_1.5px_3.5px_rgba(165,180,252,0.06),inset_-1.5px_-1.5px_3.5px_rgba(255,255,255,0.95)] text-gray-400 rounded-2xl text-xs font-black font-mono outline-none cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1.5 animate-in fade-in flex flex-col justify-end">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider ml-1 mb-1">Code Promo Rattaché</label>
                    <input 
                      type="text"
                      value={promoCodeRaw}
                      disabled
                      className="w-full px-4 py-3 bg-[#F4F7F6]/60 border-none shadow-[inset_1.5px_1.5px_3.5px_rgba(165,180,252,0.06),inset_-1.5px_-1.5px_3.5px_rgba(255,255,255,0.95)] text-indigo-700 rounded-2xl text-xs font-black font-mono outline-none cursor-not-allowed uppercase"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 animate-in fade-in">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider ml-1">Nom complet / Nom d'affichage d'affaires</label>
                  <input 
                    type="text"
                    required
                    value={profileForm.displayName}
                    onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                    className="w-full px-4 py-3 bg-[#F4F7F6] border-none shadow-[inset_2.5px_2.5px_5px_rgba(165,180,252,0.14),inset_-2.5px_-2.5px_5px_rgba(255,255,255,0.9)] text-gray-900 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-[#2563EB]/45 transition duration-300"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="space-y-1.5 animate-in fade-in">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider ml-1">Numéro de Téléphone</label>
                    <input 
                      type="tel"
                      value={profileForm.phone}
                      onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                      className="w-full px-4 py-3 bg-[#F4F7F6] border-none shadow-[inset_2.5px_2.5px_5px_rgba(165,180,252,0.14),inset_-2.5px_-2.5px_5px_rgba(255,255,255,0.9)] text-gray-900 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-[#2563EB]/45 transition duration-300"
                      placeholder="Ex: +33 600 000"
                    />
                  </div>

                  <div className="space-y-1.5 animate-in fade-in">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider ml-1">Adresse E-mail d'Affaire</label>
                    <input 
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                      className="w-full px-4 py-3 bg-[#F4F7F6] border-none shadow-[inset_2.5px_2.5px_5px_rgba(165,180,252,0.14),inset_-2.5px_-2.5px_5px_rgba(255,255,255,0.9)] text-gray-900 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-[#2563EB]/45 transition duration-300"
                      placeholder="Ex: contact@apporteur.com"
                    />
                  </div>
                </div>

                <div className="pt-3">
                  <button 
                    type="submit"
                    disabled={editLoading}
                    className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white text-xs font-black rounded-full shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:shadow-[0_12px_28px_rgba(37,99,235,0.35)] transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest disabled:bg-indigo-400"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>Enregistrer</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
