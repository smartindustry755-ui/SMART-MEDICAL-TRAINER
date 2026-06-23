import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  Users, TrendingUp, Settings, LayoutGrid, Calendar, LogOut, 
  Menu, Key, ShieldAlert, CheckCircle, AlertCircle, Copy, Search,
  GraduationCap, Phone, Mail, Award, Clock, Loader2, Lock, Coins, X, ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, query, onSnapshot, doc, updateDoc, 
  getDoc, getDocs, where, setDoc 
} from 'firebase/firestore';
import { cn, safeLocalStorage } from '../lib/utils';
import { formatCurrency, recordFinancialTransaction, DEFAULT_LICENSE_PARAMS, LicenseParams } from '../lib/finances';

interface UserProfile {
  id: string;
  username: string;
  password?: string;
  email?: string;
  role: 'admin' | 'student' | 'partner';
  displayName?: string;
  phone?: string;
  createdAt?: any;
  expiresAt?: any;
  filiere?: string;
  niveau?: string;
  promoCode?: string;
  partnerId?: string;
  hasLoggedIn?: boolean;
  lastLogin?: any;
  status?: 'active' | 'suspended' | 'expired';
}

interface PartnerInterfaceProps {
  onLogout: () => void;
  setIsSidebarOpen?: (open: boolean) => void;
  onEnterStudentSpace?: (filiere: string) => void;
}

export const PARTNER_FILIERES = [
  { id: 'ECN', name: 'Médecine (ECN)' },
  { id: 'IDE', name: 'Infirmier (IDE)' },
  { id: 'sage_femme', name: 'Sage-femme' },
  { id: 'kinetherapie', name: 'Kinésithérapie' },
  { id: 'pharmacie', name: 'Pharmacie' },
  { id: 'EM', name: 'Études Médicales (EM)' },
  { id: 'TIM', name: 'TIM (Imagerie Médicale)' }
];

export default function PartnerInterface({ onLogout, setIsSidebarOpen, onEnterStudentSpace }: PartnerInterfaceProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const savedUser = safeLocalStorage.getItem('ais_user');
  const user = savedUser ? JSON.parse(savedUser) : null;

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'stats' | 'finances' | 'admin' | 'profile'>('dashboard');
  const [globalCurrency, setGlobalCurrency] = useState('XOF');
  const [selectedStudent, setSelectedStudent] = useState<UserProfile | null>(null);

  const [partnerProfile, setPartnerProfile] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transLoading, setTransLoading] = useState(true);
  const [licenseParamsList, setLicenseParamsList] = useState<LicenseParams[]>([]);
  const [isRatesModalOpen, setIsRatesModalOpen] = useState(false);
  const [partnerExpenses, setPartnerExpenses] = useState<any[]>([]);

  const partnerConfig = partnerProfile || user;
  const partnerPromoCode = (partnerConfig?.promoCode || '').toUpperCase().trim();

  // Delegated user creation state
  const [delegatedUserForm, setDelegatedUserForm] = useState({
    username: '',
    displayName: '',
    password: '',
    phone: '',
    email: '',
    filiere: '',
    niveau: '',
    months: 3,
  });
  const [delegatedMsg, setDelegatedMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [delegatedLoading, setDelegatedLoading] = useState(false);

  const handleCreateDelegatedUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setDelegatedLoading(true);
    setDelegatedMsg(null);

    const targetUsername = delegatedUserForm.username.toLowerCase().trim().replace(/\s+/g, '');
    const userRef = doc(db, 'users', targetUsername);

    try {
      // Check if username taken
      let existsSnap;
      try {
        existsSnap = await getDoc(userRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${targetUsername}`);
        throw err;
      }

      if (existsSnap.exists()) {
        setDelegatedMsg({ type: 'error', text: 'Cet identifiant unique est déjà pris.' });
        setDelegatedLoading(false);
        return;
      }

      const expires = new Date();
      expires.setMonth(expires.getMonth() + Number(delegatedUserForm.months));

      const newStudentData = {
        id: targetUsername,
        username: targetUsername,
        displayName: delegatedUserForm.displayName.trim(),
        password: delegatedUserForm.password,
        phone: delegatedUserForm.phone.trim(),
        email: delegatedUserForm.email.toLowerCase().trim(),
        filiere: delegatedUserForm.filiere || 'ECN',
        niveau: delegatedUserForm.niveau || 'ALL',
        role: 'student',
        status: 'active',
        partnerId: user.id || user.username,
        promoCode: partnerPromoCode || '',
        createdAt: new Date(),
        expiresAt: expires,
        hasLoggedIn: false,
      };

      try {
        await setDoc(userRef, newStudentData);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${targetUsername}`);
        throw err;
      }

      try {
        await recordFinancialTransaction({
          userId: targetUsername,
          username: targetUsername,
          licenseId: delegatedUserForm.filiere || 'ECN',
          durationMonths: Number(delegatedUserForm.months),
          promoCodeUsed: partnerPromoCode || '',
          partnerId: user.id || user.username
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'financialHistory');
        throw err;
      }

      setDelegatedMsg({ type: 'success', text: `Abonné @${targetUsername} créé avec succès pour ${delegatedUserForm.months} mois.` });
      // Reset form
      setDelegatedUserForm({
        username: '',
        displayName: '',
        password: '',
        phone: '',
        email: '',
        filiere: '',
        niveau: '',
        months: 3,
      });
    } catch (err: any) {
      console.error(err);
      setDelegatedMsg({ type: 'error', text: 'Erreur lors de la création de cet abonné.' });
    } finally {
      setDelegatedLoading(false);
    }
  };

  // Quick profile form edits
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
    
    // Subscribe to global settings (currency)
    const unsubGlobalSettings = onSnapshot(doc(db, 'settings', 'financialSettings'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().currency) {
        setGlobalCurrency(docSnap.data().currency);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'settings/financialSettings');
    });

    // Subscribe to partners latest configuration
    const docRef = doc(db, 'users', user.id || user.username);
    const unsubProfile = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        setPartnerProfile(snap.data());
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${user.id || user.username}`);
    });

    // Fetch users for calculations
    const q = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(q, (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'users');
      setLoading(false);
    });

    // Subscribe to Financial History
    const qTrans = query(collection(db, 'financialHistory'));
    const unsubTrans = onSnapshot(qTrans, (snap) => {
      const allTrans = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTransactions(allTrans);
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

      // Ensure all default licenses exist in the list
      Object.entries(DEFAULT_LICENSE_PARAMS).forEach(([id, fallback]) => {
        if (!existingIds.has(id)) {
          data.push({ id, ...fallback } as LicenseParams);
        }
      });
      setLicenseParamsList(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'licenseParams');
    });

    // Subscribe to partner specific expenses (payouts)
    const qExp = query(collection(db, 'expenses'), where('partnerId', '==', user?.id || user?.username || ''));
    const unsubExp = onSnapshot(qExp, (snap) => {
      setPartnerExpenses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'expenses');
    });

    return () => {
      unsubGlobalSettings();
      unsubProfile();
      unsubscribeUsers();
      unsubTrans();
      unsubParams();
      unsubExp();
    };
  }, [user?.id, user?.username]);

  useEffect(() => {
    const path = location.pathname;
    if (path === '/' || path === '/partner' || path === '/partner/dashboard') {
      setActiveTab('dashboard');
    } else if (path === '/partner/users') {
      setActiveTab('users');
    } else if (path === '/partner/stats') {
      setActiveTab('stats');
    } else if (path === '/partner/finances') {
      setActiveTab('finances');
    } else if (path === '/partner/admin') {
      setActiveTab('admin');
    } else if (path === '/partner/profile') {
      setActiveTab('profile');
    }
  }, [location.pathname]);

  if (!user || user.role !== 'partner') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full text-center space-y-4 p-8 bg-white rounded-3xl shadow-xl border border-gray-100">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-2xl font-black text-gray-900 leading-tight">Accès réservé</h2>
          <p className="text-gray-500 text-sm font-medium">Vous devez posséder un compte Partenaire actif pour accéder à cet espace.</p>
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

  const cleanPromoString = (s: string) => {
    return (s || '')
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };

  const cleanPartnerPromo = cleanPromoString(partnerPromoCode);

  // Filter students linked to this partner with strict parameter enforcement
  const rattachés = users.filter(u => {
    if (u.role !== 'student') return false;

    const belongsByPromo = !!(cleanPartnerPromo && u.promoCode && cleanPromoString(u.promoCode) === cleanPartnerPromo);

    // Filter by allowedFilieres comparison
    const allowedFils = partnerConfig?.allowedFilieres || [];
    const matchesFiliere = allowedFils.length > 0 && u.filiere && allowedFils.some(fId => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const fIdLow = fId.toLowerCase().trim();
      return uFil.includes(fIdLow) || fIdLow.includes(uFil);
    });

    // Filter by allowedLicences comparison
    const allowedLics = partnerConfig?.allowedLicences || [];
    const matchesLicence = allowedLics.length > 0 && u.filiere && allowedLics.some(lId => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const lIdLow = lId.toLowerCase().trim();
      return uFil.includes(lIdLow) || lIdLow.includes(uFil);
    });

    return belongsByPromo || !!matchesFiliere || !!matchesLicence;
  });

  const promoSubscribers = users.filter(u => {
    if (u.role !== 'student') return false;
    return !!(cleanPartnerPromo && u.promoCode && cleanPromoString(u.promoCode) === cleanPartnerPromo);
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
    
    // Choose correct price tier based on approx months
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
        approxMonths = 12; // default manual
      }
    }

    let price = lic.price3m;
    if (approxMonths === 6) price = lic.price6m;
    else if (approxMonths === 12) price = lic.price12m;

    const isPromoUser = !!(cleanPartnerPromo && u.promoCode && cleanPromoString(u.promoCode) === cleanPartnerPromo);
    
    // Check if partner is partner of license
    const allowedFils = partnerConfig?.allowedFilieres || [];
    const matchesFiliere = allowedFils.length > 0 && u.filiere && allowedFils.some(fId => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const fIdLow = fId.toLowerCase().trim();
      return uFil.includes(fIdLow) || fIdLow.includes(uFil);
    });

    const allowedLics = partnerConfig?.allowedLicences || [];
    const matchesLicence = allowedLics.length > 0 && u.filiere && allowedLics.some(lId => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const lIdLow = lId.toLowerCase().trim();
      return uFil.includes(lIdLow) || lIdLow.includes(uFil);
    });

    const isPartnerOfLicence = !!(matchesFiliere || matchesLicence || u.partnerId === user.id || u.partnerId === user.username);

    // Commission percentage
    const promoPct = lic.promoCommission ?? 10;
    const partnerPct = lic.partnerCommission ?? 15;

    const comPartner = isPartnerOfLicence ? Math.round((price * (partnerPct / 100)) * 100) / 100 : 0;
    const comPromo = isPromoUser ? Math.round((price * (promoPct / 100)) * 100) / 100 : 0;

    const totalCommission = comPartner + comPromo;
    const remaining = Math.round((price - totalCommission) * 100) / 100;

    return {
      price,
      commissionPartner: comPartner,
      commissionPromo: comPromo,
      commission: totalCommission,
      ratePartner: isPartnerOfLicence ? partnerPct : 0,
      ratePromo: isPromoUser ? promoPct : 0,
      remaining,
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

  const activeStudents = rattachés.filter(isStudentActive);
  const expiredStudents = rattachés.filter(u => !isStudentActive(u));

  // Inscriptions this month
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthlyInscriptions = rattachés.filter(u => {
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

      // Update cached session
      const updatedUser = { 
        ...user, 
        displayName: profileForm.displayName,
        phone: profileForm.phone,
        email: profileForm.email 
      };
      safeLocalStorage.setItem('ais_user', JSON.stringify(updatedUser));
      setStatusMessage({ type: 'success', text: 'Profil mis à jour avec succès !' });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Une erreur est survenue lors de la modification.' });
    } finally {
      setEditLoading(false);
    }
  };

  const handleNavigateTo = (tab: string, path: string) => {
    navigate(path);
  };

  // Searching users
  const filteredRattachés = rattachés.filter(u => {
    const searchLow = searchTerm.toLowerCase();
    const matchesName = u.displayName?.toLowerCase().includes(searchLow);
    const matchesUsername = u.username?.toLowerCase().includes(searchLow);
    const matchesFiliere = u.filiere?.toLowerCase().includes(searchLow);
    return matchesName || matchesUsername || matchesFiliere;
  });

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-7xl mx-auto w-full">
      {/* Upper header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-6">
        <div>
          <span className="text-xs font-bold text-indigo-500 uppercase tracking-widest font-mono">Espace Partenaire</span>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-none mt-1">
            Bonjour, <span className="text-indigo-600">{user.displayName || user.username}</span>
          </h1>
          <p className="text-sm text-gray-500 font-medium mt-1">Visualisez l'activité et le parcours d'apprentissage de vos abonnés.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          {partnerPromoCode && (
            <div className="bg-indigo-50/70 border border-indigo-150/40 p-4 rounded-2xl flex items-center gap-4 transition-all duration-300 hover:shadow-md max-w-sm w-full sm:w-auto">
              <div>
                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest font-mono">Votre code Promo</p>
                <p className="text-lg font-black text-indigo-800 tracking-wider font-mono">{partnerPromoCode}</p>
              </div>
              <button 
                onClick={() => handleCopyPromo(partnerPromoCode)}
                className="p-2.5 bg-white border border-indigo-100 text-indigo-600 hover:bg-indigo-100/30 rounded-xl transition-all shadow-sm active:scale-95 flex items-center justify-center"
                title="Copier le code"
              >
                {copied ? <CheckCircle className="w-4 h-4 text-green-600 animate-in zoom-in" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          )}

          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 px-5 py-3.5 bg-red-50 hover:bg-red-100/70 border border-red-150/40 text-red-600 font-bold text-xs rounded-2xl transition shadow-sm active:scale-95 self-end sm:self-auto"
            title="Se déconnecter"
          >
            <LogOut className="w-4 h-4" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      {!loading && (
        <div className="flex items-center gap-2 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none border-b border-gray-100/80">
          <button
            onClick={() => handleNavigateTo('dashboard', '/partner/dashboard')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-2xl transition-all duration-200 shrink-0",
              activeTab === 'dashboard'
                ? "bg-indigo-50 text-indigo-700 border border-indigo-100/80 shadow-xs"
                : "text-gray-500 hover:text-gray-905 hover:bg-gray-50/80 bg-white border border-transparent"
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            <span>Tableau de Bord</span>
          </button>
          
          <button
            onClick={() => handleNavigateTo('users', '/partner/users')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-2xl transition-all duration-200 shrink-0",
              activeTab === 'users'
                ? "bg-indigo-50 text-indigo-700 border border-indigo-100/80 shadow-xs"
                : "text-gray-500 hover:text-gray-905 hover:bg-gray-50/80 bg-white border border-transparent"
            )}
          >
            <Users className="w-4 h-4" />
            <span>Mes Abonnés</span>
          </button>

          <button
            onClick={() => handleNavigateTo('stats', '/partner/stats')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-2xl transition-all duration-200 shrink-0",
              activeTab === 'stats'
                ? "bg-indigo-50 text-indigo-700 border border-indigo-100/80 shadow-xs"
                : "text-gray-500 hover:text-gray-905 hover:bg-gray-50/80 bg-white border border-transparent"
            )}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Statistiques</span>
          </button>

          <button
            onClick={() => handleNavigateTo('finances', '/partner/finances')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-2xl transition-all duration-200 shrink-0",
              activeTab === 'finances'
                ? "bg-emerald-50 text-emerald-700 border border-emerald-100/80 shadow-xs"
                : "text-gray-500 hover:text-gray-905 hover:bg-gray-50/80 bg-white border border-transparent"
            )}
          >
            <Coins className="w-4 h-4" />
            <span>Mes Finances</span>
          </button>

          {(partnerProfile?.hasAdminAccess || user?.hasAdminAccess) && (
            <button
              onClick={() => handleNavigateTo('admin', '/partner/admin')}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-2xl transition-all duration-200 shrink-0",
                activeTab === 'admin'
                  ? "bg-rose-50 text-rose-700 border border-rose-100 shadow-xs"
                  : "text-gray-500 hover:text-gray-905 hover:bg-gray-50/80 bg-white border border-transparent"
              )}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Admin Délégué</span>
            </button>
          )}

          <button
            onClick={() => handleNavigateTo('profile', '/partner/profile')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-2xl transition-all duration-200 shrink-0",
              activeTab === 'profile'
                ? "bg-indigo-50 text-indigo-700 border border-indigo-100/80 shadow-xs"
                : "text-gray-500 hover:text-gray-905 hover:bg-gray-50/80 bg-white border border-transparent"
            )}
          >
            <Settings className="w-4 h-4" />
            <span>Mon Profil</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="h-96 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          <p className="text-sm text-gray-400 font-bold">Synchronisation des données...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              {/* Quick Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm flex items-center gap-4">
                  <div className="p-4 bg-blue-50 text-blue-600 rounded-xl">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest font-mono">Mes abonnés</p>
                    <p className="text-2xl font-black text-gray-900">{promoSubscribers.length}</p>
                  </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm flex items-center gap-4">
                  <div className="p-4 bg-green-50 text-green-600 rounded-xl">
                    <CheckCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest font-mono">Utilisateurs Actifs</p>
                    <p className="text-2xl font-black text-gray-900">{activeStudents.length}</p>
                  </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm flex items-center gap-4">
                  <div className="p-4 bg-red-50 text-red-600 rounded-xl">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest font-mono">Utilisateurs Expirés</p>
                    <p className="text-2xl font-black text-gray-900">{expiredStudents.length}</p>
                  </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm flex items-center gap-4">
                  <div className="p-4 bg-indigo-50 text-indigo-600 rounded-xl">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest font-mono">Inscrits ce mois</p>
                    <p className="text-2xl font-black text-gray-900">{monthlyInscriptions.length}</p>
                  </div>
                </div>
              </div>

              {/* ACCÈS AUX TABLEAUX DE BORD FILIÈRES */}
              <div className="bg-gradient-to-br from-indigo-50/70 via-blue-50/20 to-white border border-indigo-100/60 rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-indigo-600" />
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest font-mono">Simulations & QCM</span>
                  </div>
                  <h3 className="text-xl font-black text-gray-950 tracking-tight">Accéder au Tableau de Bord Étudiant</h3>
                  <p className="text-xs text-gray-500 font-medium leading-relaxed max-w-3xl">
                    Testez l'application et les fonctionnalités de révision du point de vue de vos candidats. Répondez aux fiches de QCM, lancez des examens blancs et découvrez l'expérience utilisateur complète pour les filières dont vous assurez le parrainage.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
                  {(partnerConfig?.allowedFilieres && partnerConfig.allowedFilieres.length > 0 ? partnerConfig.allowedFilieres : ['ECN']).map((filId: string) => {
                    const matchedOption = PARTNER_FILIERES.find(f => f.id.toUpperCase() === filId.trim().toUpperCase()) || { id: filId, name: filId };
                    return (
                      <button
                        key={filId}
                        onClick={() => onEnterStudentSpace && onEnterStudentSpace(filId)}
                        className="flex items-center justify-between p-5 bg-white hover:bg-indigo-50/40 border border-gray-150 hover:border-indigo-200 rounded-2xl shadow-xs hover:shadow-md transition duration-200 group text-left cursor-pointer"
                      >
                        <div className="space-y-1">
                          <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest font-mono block">Visualiser l'espace</span>
                          <span className="text-sm font-extrabold text-blue-950 group-hover:text-indigo-900 transition">{matchedOption.name}</span>
                        </div>
                        <div className="w-9 h-9 bg-indigo-50 group-hover:bg-indigo-600 rounded-xl flex items-center justify-center text-indigo-600 group-hover:text-white transition-all">
                          <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Promo code detail block */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Promo Code Info Cards */}
                <div className="bg-gradient-to-br from-indigo-900 to-slate-950 p-8 rounded-3xl text-white shadow-xl flex flex-col justify-between hover:shadow-2xl transition duration-300 min-h-[250px]">
                  <div>
                    <Award className="w-8 h-8 text-indigo-400 mb-4" />
                    <h3 className="text-lg font-black tracking-tight mb-2">Code Promo Actif</h3>
                    <p className="text-xs text-indigo-200 leading-relaxed font-medium">Ce code permet de parrainer vos abonnés et contribue à rattacher directement les nouveaux candidats inscrits à votre interface de suivi.</p>
                  </div>
                  
                  <div className="mt-6 flex items-center justify-between bg-white/10 px-4 py-3 rounded-2xl border border-white/10">
                    <span className="font-mono text-sm tracking-wider uppercase font-bold text-indigo-100">{partnerPromoCode || 'AUCUN'}</span>
                    <button 
                      onClick={() => partnerPromoCode && handleCopyPromo(partnerPromoCode)}
                      className="text-xs font-bold bg-white text-indigo-950 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition active:scale-95"
                    >
                      Copier
                    </button>
                  </div>
                </div>

                {/* Uses metrics */}
                <div className="bg-white border border-gray-150 rounded-3xl p-8 shadow-sm flex flex-col justify-between min-h-[250px]">
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">Compteur d'utilisations</span>
                    <h3 className="text-lg font-black text-gray-900 tracking-tight mt-1 mb-2">Activations de Licences</h3>
                    <p className="text-xs text-gray-400 leading-relaxed font-semibold">Volume d'utilisateurs parrainés ayant entré votre code promo lors de leur inscription ou rattachés par l'administration.</p>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-4">
                    <div className="bg-indigo-50/50 border border-indigo-100/50 p-4 rounded-xl text-center">
                      <p className="text-[10px] text-indigo-500 font-extrabold uppercase tracking-widest">Utilisations</p>
                      <p className="text-2xl font-black text-indigo-950 mt-1">{promoSubscribers.length}</p>
                    </div>
                    <div className="bg-emerald-50/50 border border-emerald-100/50 p-4 rounded-xl text-center">
                      <p className="text-[10px] text-emerald-600 font-extrabold uppercase tracking-widest">Licences Actives</p>
                      <p className="text-2xl font-black text-emerald-950 mt-1">{activeStudents.length}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-gray-150 rounded-3xl p-8 shadow-sm flex flex-col justify-between min-h-[250px]">
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">Performance mensuelle</span>
                    <h3 className="text-lg font-black text-gray-900 tracking-tight mt-1 mb-2">Nouvelles Acquisitions</h3>
                    <p className="text-xs text-gray-400 leading-relaxed font-semibold">Suivi de la courbe d'intérêt et des nouvelles inscriptions pour le mois calendaire en cours.</p>
                  </div>

                  <div className="mt-6 flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 font-black text-sm">
                        {monthlyInscriptions.length}
                      </div>
                      <div>
                        <p className="text-xs font-extrabold text-gray-900">Inscrits {now.toLocaleDateString('fr-FR', { month: 'long' })}</p>
                        <p className="text-[10px] text-gray-400 font-bold">Nouveaux candidats</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleNavigateTo('users', '/partner/users')}
                      className="text-xs font-bold text-indigo-600 hover:underline"
                    >
                      Détail
                    </button>
                  </div>
                </div>
              </div>

              {/* Recent subscribers */}
              <div className="bg-white border border-gray-150 rounded-3xl p-6 shadow-sm space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-gray-50">
                  <h3 className="text-base font-extrabold text-indigo-950">Abonnés récents parrainés</h3>
                  <button 
                    onClick={() => handleNavigateTo('users', '/partner/users')}
                    className="text-xs font-bold text-indigo-600 hover:underline"
                  >
                    Voir tous les utilisateurs ({rattachés.length}) →
                  </button>
                </div>

                {rattachés.length === 0 ? (
                  <p className="text-sm text-gray-400 font-medium italic py-8 text-center">Aucun utilisateur rattaché pour le moment.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                          <th className="pb-3 pr-4">Candidat</th>
                          <th className="pb-3 px-4">Filière / Niveau</th>
                          <th className="pb-3 px-4">Inscription</th>
                          <th className="pb-3 px-4">Fin de Licence</th>
                          <th className="pb-3 px-4">Temps Restant</th>
                          <th className="pb-3 pl-4 text-right">État</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-xs font-semibold text-gray-700">
                        {rattachés.slice(0, 5).map(u => {
                          const days = calculateDaysRemaining(u.expiresAt);
                          const isActive = isStudentActive(u);
                          return (
                            <tr key={u.id} className="hover:bg-gray-50/30 transition-colors">
                              <td className="py-3.5 pr-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 font-bold text-xs flex items-center justify-center">
                                    {u.displayName?.[0]?.toUpperCase() || u.username?.[0]?.toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-900">{u.displayName || u.username}</p>
                                    <p className="text-[10px] text-gray-400">@{u.username}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="bg-gray-100 px-2 py-1 rounded text-[10px] text-gray-600 font-bold">{u.filiere || 'ECN'} ({u.niveau || 'ALL'})</span>
                              </td>
                              <td className="py-3.5 px-4 text-gray-500">
                                {u.createdAt ? (
                                  u.createdAt.toDate ? u.createdAt.toDate().toLocaleDateString('fr-FR') : new Date(u.createdAt).toLocaleDateString('fr-FR')
                                ) : 'N/A'}
                              </td>
                              <td className="py-3.5 px-4 text-gray-500">
                                {u.expiresAt ? (
                                  u.expiresAt.toDate ? u.expiresAt.toDate().toLocaleDateString('fr-FR') : new Date(u.expiresAt).toLocaleDateString('fr-FR')
                                ) : 'Illimitée'}
                              </td>
                              <td className="py-3.5 px-4 font-mono">
                                {typeof days === 'number' ? (
                                  days > 0 ? (
                                    <span className="text-green-600 font-bold">{days} jr{days > 1 ? 's' : ''}</span>
                                  ) : (
                                    <span className="text-red-600 font-bold">Expiré</span>
                                  )
                                ) : (
                                  <span className="text-gray-400">Illimité</span>
                                )}
                              </td>
                              <td className="py-3.5 pl-4 text-right">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-[10px] uppercase font-black",
                                  isActive ? "bg-green-150 text-green-700" : "bg-red-150 text-red-700"
                                )}>
                                  {isActive ? 'Actif' : 'Expiré'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: MES UTILISATEURS */}
          {activeTab === 'users' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center">
                <h3 className="text-xl font-extrabold text-indigo-950">Liste Complète de mes Candidats ({rattachés.length})</h3>
                <div className="relative max-w-sm w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Recherche (nom, filière, pseudo)"
                    className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                  />
                </div>
              </div>

              {filteredRattachés.length === 0 ? (
                <div className="bg-white border border-gray-150 rounded-2xl p-12 text-center text-gray-400 font-medium italic">
                  Aucun inscrit trouvé correspondant à votre filtre.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                  {/* Candidates table column */}
                  <div className="lg:col-span-2 bg-white border border-gray-150 rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-150 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none">
                            <th className="px-5 py-3">Candidat</th>
                            <th className="px-5 py-3">Filière / Niveau</th>
                            <th className="px-5 py-3">Temps restant</th>
                            <th className="px-5 py-3">Dernière connexion</th>
                            <th className="px-5 py-3 text-right">Détails</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                          {filteredRattachés.map(u => {
                            const days = calculateDaysRemaining(u.expiresAt);
                            const isActive = isStudentActive(u);
                            const isSelected = selectedStudent?.id === u.id;
                            return (
                              <tr 
                                key={u.id} 
                                onClick={() => setSelectedStudent(u)}
                                className={cn(
                                  "hover:bg-indigo-50/20 transition-all cursor-pointer",
                                  isSelected ? "bg-indigo-50/50 border-l-4 border-indigo-600 pl-4" : ""
                                )}
                              >
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 font-extrabold text-xs flex items-center justify-center">
                                      {u.displayName?.[0]?.toUpperCase() || u.username?.[0]?.toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="font-bold text-gray-900">{u.displayName || u.username}</p>
                                      <p className="text-[10px] text-gray-400 font-mono">@{u.username}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-5 py-3.5">
                                  <span className="font-extrabold text-indigo-900">{u.filiere || 'ECN'}</span>
                                  <span className="text-[10px] text-gray-400 block">{u.niveau || 'ALL'}</span>
                                </td>
                                <td className="px-5 py-3.5">
                                  {typeof days === 'number' ? (
                                    days > 0 ? (
                                      <span className="text-green-600">{days} jr{days > 1 ? 's' : ''}</span>
                                    ) : (
                                      <span className="text-red-500">Expiré</span>
                                    )
                                  ) : (
                                    <span className="text-gray-400">Illimité</span>
                                  )}
                                </td>
                                <td className="px-5 py-3.5 text-gray-400 font-medium">
                                  {u.lastLogin ? (
                                    u.lastLogin.toDate ? u.lastLogin.toDate().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : new Date(u.lastLogin).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
                                  ) : 'Jamais'}
                                </td>
                                <td className="px-5 py-3.5 text-right font-bold text-indigo-600">
                                  Sélectionner
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Sidebar quick sheet detail view (READ ONLY ONLY!) */}
                  <div className="bg-white border border-gray-150 rounded-2xl p-6 shadow-sm space-y-6">
                    {selectedStudent ? (
                      <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        {/* ACCESSIBLE RETOUR BUTTON */}
                        <div className="flex justify-start">
                          <button 
                            onClick={() => setSelectedStudent(null)}
                            className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100/50 px-3.5 py-1.5 rounded-xl transition"
                          >
                            ← Retour à la liste
                          </button>
                        </div>

                        <div className="text-center space-y-3 pb-4 border-b border-gray-100">
                          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-100 to-blue-100 text-indigo-700 font-black text-2xl flex items-center justify-center mx-auto shadow-inner">
                            {selectedStudent.displayName?.[0]?.toUpperCase() || selectedStudent.username?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <h4 className="text-lg font-black text-gray-900">{selectedStudent.displayName || selectedStudent.username}</h4>
                            <p className="text-xs text-gray-400">@{selectedStudent.username}</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h5 className="text-[10px] font-black tracking-widest text-gray-400 uppercase font-mono">Détails d'Abonnement (Lecture seule)</h5>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
                              <span className="text-[9px] text-gray-400 font-bold uppercase block">Filière d'étude</span>
                              <span className="font-extrabold text-indigo-950 text-sm block mt-0.5">{selectedStudent.filiere || 'ECN'}</span>
                            </div>
                            <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
                              <span className="text-[9px] text-gray-400 font-bold uppercase block">Niveau actuel</span>
                              <span className="font-extrabold text-indigo-950 text-sm block mt-0.5">{selectedStudent.niveau || 'ALL'}</span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between p-3 bg-gray-50 rounded-xl border border-gray-50 text-xs font-semibold">
                              <span className="text-gray-400 flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" />Inscrit le</span>
                              <span className="text-gray-900">
                                {selectedStudent.createdAt ? (
                                  selectedStudent.createdAt.toDate ? selectedStudent.createdAt.toDate().toLocaleDateString('fr-FR') : new Date(selectedStudent.createdAt).toLocaleDateString('fr-FR')
                                ) : 'N/A'}
                              </span>
                            </div>

                            <div className="flex justify-between p-3 bg-gray-50 rounded-xl border border-gray-50 text-xs font-semibold">
                              <span className="text-gray-400 flex items-center gap-1.5"><Calendar className="w-4 h-4 text-indigo-500" />Fin de Licence</span>
                              <span className="text-gray-900">
                                {selectedStudent.expiresAt ? (
                                  selectedStudent.expiresAt.toDate ? selectedStudent.expiresAt.toDate().toLocaleDateString('fr-FR') : new Date(selectedStudent.expiresAt).toLocaleDateString('fr-FR')
                                ) : 'Créancier Infini'}
                              </span>
                            </div>

                            <div className="flex justify-between p-3 bg-gray-50 rounded-xl border border-gray-50 text-xs font-semibold">
                              <span className="text-gray-400 flex items-center gap-1.5"><Phone className="w-4 h-4 text-green-500" />Contact Téléphone</span>
                              <span className="text-gray-900">{selectedStudent.phone || <em className="text-gray-300">Non spécifié</em>}</span>
                            </div>

                            <div className="flex justify-between p-3 bg-gray-50 rounded-xl border border-gray-50 text-xs font-semibold">
                              <span className="text-gray-400 flex items-center gap-1.5"><Mail className="w-4 h-4 text-blue-500" />Messagerie Email</span>
                              <span className="text-gray-900 font-mono truncate max-w-[120px]">{selectedStudent.email || <em className="text-gray-300">Non renseignée</em>}</span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 text-xs text-indigo-800 text-center font-bold">
                          ℹ️ Mode lecture seule activé pour ce profil.
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-16 text-gray-400 italic">
                        Sélectionnez un abonné dans la liste pour afficher ses détails d'études et coordonnées de contact.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: STATISTIQUES */}
          {activeTab === 'stats' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <h3 className="text-xl font-extrabold text-indigo-950">Analyses d'Abonnements de votre Réseau</h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Active Vs Expired Visualiser */}
                <div className="bg-white border border-gray-150 rounded-2xl p-6 shadow-sm space-y-4">
                  <h4 className="text-sm font-black text-gray-900">Statut des licences d'utilisateurs</h4>
                  
                  {rattachés.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Aucune donnée disponible</p>
                  ) : (
                    <div className="space-y-4 pt-2">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-green-600">Actifs ({activeStudents.length})</span>
                        <span className="text-red-500">Expirés ({expiredStudents.length})</span>
                      </div>

                      {/* Stacked bar */}
                      <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden flex">
                        <div 
                          className="bg-green-500 h-full transition-all duration-500"
                          style={{ width: `${(activeStudents.length / rattachés.length) * 100}%` }}
                          title="Pourcentage actif"
                        />
                        <div 
                          className="bg-red-400 h-full transition-all duration-500"
                          style={{ width: `${(expiredStudents.length / rattachés.length) * 100}%` }}
                          title="Pourcentage expiré"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4 pt-2 text-xs font-bold">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-mono">Taux d'activité</p>
                          <p className="text-base text-gray-900 font-black">{Math.round((activeStudents.length / rattachés.length) * 100)} %</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-mono">Taux d'expiration</p>
                          <p className="text-base text-gray-900 font-black">{Math.round((expiredStudents.length / rattachés.length) * 100)} %</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Filiere study representation */}
                <div className="bg-white border border-gray-150 rounded-2xl p-6 shadow-sm space-y-4">
                  <h4 className="text-sm font-black text-gray-900">Distribution par Filière</h4>
                  
                  {rattachés.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Aucune donnée disponible</p>
                  ) : (
                    <div className="space-y-3 pt-1">
                      {['ECN', 'EM', 'PHYSIO'].map(fil => {
                        const count = rattachés.filter(u => u.filiere === fil).length;
                        const pct = count > 0 ? Math.round((count / rattachés.length) * 100) : 0;
                        return (
                          <div key={fil} className="space-y-1">
                            <div className="flex justify-between text-xs font-bold text-gray-700">
                              <span>filière {fil}</span>
                              <span>{count} ({pct}%)</span>
                            </div>
                            <div className="w-full h-2 bg-gray-105 rounded-full overflow-hidden">
                              <div 
                                className="bg-indigo-600 h-full rounded-full transition-all duration-500" 
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Monthly growth progression */}
                <div className="bg-white border border-gray-150 rounded-2xl p-6 shadow-sm space-y-4">
                  <h4 className="text-sm font-black text-gray-900">Adhésion & Croissance</h4>

                  <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100/50 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold">Inscrits ce mois</p>
                      <p className="text-xl font-black text-indigo-950 mt-1">+{monthlyInscriptions.length} abonnés</p>
                    </div>
                    <span className="text-xs font-black text-green-600 bg-green-50 px-2 py-1 rounded-md">Action active</span>
                  </div>

                  <p className="text-xs text-gray-400 font-medium leading-relaxed">
                    Le nombre de licences de parrainage actives reste stable. Diffusez au maximum votre code promotionnel pour accumuler des filleuls et accroître vos opportunités de parrainage.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB: FINANCES */}
          {activeTab === 'finances' && (() => {
            const partnerPromo = partnerPromoCode;
            
            // Build resolved transactions by mapping each rattaché to a real or calculated transaction
            const resolvedTrans = rattachés.map(st => {
              // Try to find an existing real transaction in Firestore
              const foundReal = transactions.find(t => {
                const isUserMatch = (t.userId && (t.userId === st.id || t.userId === st.username)) || 
                                    (t.username && (t.username === st.id || t.username === st.username));
                return isUserMatch;
              });

              // Check if partner is partner of license
              const allowedFils = partnerConfig?.allowedFilieres || [];
              const matchesFiliere = allowedFils.length > 0 && st.filiere && allowedFils.some(fId => {
                const uFil = st.filiere?.toLowerCase().trim() || '';
                const fIdLow = fId.toLowerCase().trim();
                return uFil.includes(fIdLow) || fIdLow.includes(uFil);
              });

              const allowedLics = partnerConfig?.allowedLicences || [];
              const matchesLicence = allowedLics.length > 0 && st.filiere && allowedLics.some(lId => {
                const uFil = st.filiere?.toLowerCase().trim() || '';
                const lIdLow = lId.toLowerCase().trim();
                return uFil.includes(lIdLow) || lIdLow.includes(uFil);
              });

              const isPartnerOfLicence = !!(matchesFiliere || matchesLicence || st.partnerId === user.id || st.partnerId === user.username);
              const isPromoUser = !!(cleanPartnerPromo && st.promoCode && cleanPromoString(st.promoCode) === cleanPartnerPromo);

              const filId = (st.filiere || 'ECN').toUpperCase().trim();
              const lic = licenseParamsList.find(p => p.id.toUpperCase().trim() === filId)
                          || { promoCommission: 10, partnerCommission: 15 };
              const partnerPct = lic.partnerCommission ?? 15;
              const promoPct = lic.promoCommission ?? 10;

              if (foundReal) {
                const realPrice = Number(foundReal.amountPaid) || 0;
                const comPartner = isPartnerOfLicence ? Math.round((realPrice * (partnerPct / 100)) * 100) / 100 : 0;
                const comPromo = isPromoUser ? Math.round((realPrice * (promoPct / 100)) * 100) / 100 : 0;

                return {
                  ...foundReal,
                  amountPaid: realPrice,
                  partnerCommission: comPartner + comPromo,
                  commissionPartner: comPartner,
                  commissionPromo: comPromo,
                  promoCommission: comPromo,
                  userDisplayName: foundReal.userDisplayName || st.displayName || st.username,
                  licenseName: foundReal.licenseName || st.filiere || 'Abonnement Standard'
                };
              }

              // Otherwise build virtual transaction based on student subscription details
              const finDetails = getStudentFinanceDetails(st);

              return {
                id: `virtual-${st.id}`,
                date: st.createdAt || st.lastLogin || null,
                userId: st.id,
                username: st.username,
                userDisplayName: st.displayName || st.username,
                licenseId: st.filiere || 'ECN',
                licenseName: finDetails.licName,
                amountPaid: finDetails.price,
                promoCode: st.promoCode || '',
                partnerCommission: finDetails.commission,
                commissionPartner: finDetails.commissionPartner,
                commissionPromo: finDetails.commissionPromo,
                promoCommission: finDetails.commissionPromo,
                amountSmartWorkBook: finDetails.remaining,
                remainingAmount: finDetails.remaining,
                partnerId: st.partnerId || user.id,
                status: 'paid' as const
              };
            });

            // Keep any real transactions that don't match our rattachés list directly
            const unmappedRealTrans = transactions.filter(t => {
              const codeMatch = cleanPartnerPromo && t.promoCode && cleanPromoString(t.promoCode) === cleanPartnerPromo;
              const partnerIdMatch = t.partnerId === user.id || t.partnerId === user.username;
              const matchesRattache = rattachés.some(st => st.id === t.userId || st.username === t.userId);
              
              const isAlreadyResolved = resolvedTrans.some(rt => rt.id === t.id);
              return (codeMatch || partnerIdMatch || matchesRattache) && !isAlreadyResolved;
            });

            const mappedUnmappedRealTrans = unmappedRealTrans.map(t => {
              const isPromoUser = !!(cleanPartnerPromo && t.promoCode && cleanPromoString(t.promoCode) === cleanPartnerPromo);
              
              const matchedStudent = users.find(u => u.id === t.userId || u.username === t.userId);
              let isPartnerOfLicence = false;
              if (matchedStudent) {
                const allowedFils = partnerConfig?.allowedFilieres || [];
                const matchesFiliere = allowedFils.length > 0 && matchedStudent.filiere && allowedFils.some(fId => {
                  const uFil = matchedStudent.filiere?.toLowerCase().trim() || '';
                  const fIdLow = fId.toLowerCase().trim();
                  return uFil.includes(fIdLow) || fIdLow.includes(uFil);
                });

                const allowedLics = partnerConfig?.allowedLicences || [];
                const matchesLicence = allowedLics.length > 0 && matchedStudent.filiere && allowedLics.some(lId => {
                  const uFil = matchedStudent.filiere?.toLowerCase().trim() || '';
                  const lIdLow = lId.toLowerCase().trim();
                  return uFil.includes(lIdLow) || lIdLow.includes(uFil);
                });
                isPartnerOfLicence = !!(matchesFiliere || matchesLicence || matchedStudent.partnerId === user.id || matchedStudent.partnerId === user.username);
              } else {
                isPartnerOfLicence = t.partnerId === user.id || t.partnerId === user.username;
              }

              const filId = (t.licenseId || (matchedStudent && matchedStudent.filiere) || 'ECN').toUpperCase().trim();
              const lic = licenseParamsList.find(p => p.id.toUpperCase().trim() === filId)
                          || { promoCommission: 10, partnerCommission: 15 };
              const partnerPct = lic.partnerCommission ?? 15;
              const promoPct = lic.promoCommission ?? 10;

              const realPrice = Number(t.amountPaid) || 0;
              const comPartner = isPartnerOfLicence ? Math.round((realPrice * (partnerPct / 100)) * 100) / 100 : 0;
              const comPromo = isPromoUser ? Math.round((realPrice * (promoPct / 100)) * 100) / 100 : 0;

              return {
                ...t,
                amountPaid: realPrice,
                partnerCommission: comPartner + comPromo,
                commissionPartner: comPartner,
                commissionPromo: comPromo,
                promoCommission: comPromo,
              };
            });

            const partnerTrans = [...resolvedTrans, ...mappedUnmappedRealTrans];

            const totalPaidTrans = partnerTrans.filter(t => t.status === 'paid');
            const totalRevenueGenerated = totalPaidTrans.reduce((sum, t) => sum + (Number(t.amountPaid) || 0), 0);
            const totalPartnerComsEarned = totalPaidTrans.reduce((sum, t) => sum + (Number(t.commissionPartner || 0)), 0);
            const totalPromoComsEarned = totalPaidTrans.reduce((sum, t) => sum + (Number(t.commissionPromo || t.promoCommission || 0)), 0);
            const grandTotalComs = totalPartnerComsEarned + totalPromoComsEarned;
            const totalSmartRemaining = totalPaidTrans.reduce((sum, t) => sum + (Number(t.remainingAmount || t.amountSmartWorkBook || 0)), 0);

            const totalPartnerPayouts = partnerExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
            const remainingPartnerBalance = Math.max(0, grandTotalComs - totalPartnerPayouts);

            return (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-black text-gray-900 leading-tight">Mes Statistiques Financières</h3>
                    <p className="text-gray-500 text-xs font-semibold mt-1">Historique des ventes, commissions et chiffres d'affaires associés à vos parrainages.</p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => setIsRatesModalOpen(true)}
                      className="bg-indigo-600 text-white px-4 py-2.5 text-xs font-black rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-1.5 shadow-md shadow-indigo-100"
                    >
                      <Coins className="w-4 h-4" /> Détail des Pourcentages
                    </button>
                    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                      <Coins className="w-5 h-5 text-indigo-600" />
                      <div>
                        <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-black leading-none font-mono">Code Promo de parrainage</p>
                        <p className="text-sm font-black text-indigo-950 mt-1">{partnerPromoCode || 'AUCUN'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dashboard Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                  <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                    <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider block">Licences vendues</span>
                    <span className="text-2xl font-black text-gray-900 block mt-1.5">{totalPaidTrans.length}</span>
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-bold mt-2 inline-block">Confirmées</span>
                  </div>

                  <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                    <span className="text-[9px] text-indigo-600 font-bold uppercase tracking-wider block">Part Partner</span>
                    <span className="text-xl font-black text-indigo-600 block mt-1.5">{formatCurrency(totalPartnerComsEarned, globalCurrency)}</span>
                    <span className="text-[10px] text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded-md font-bold mt-2 inline-block">Direct de base</span>
                  </div>

                  <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                    <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider block">Part Code Promo</span>
                    <span className="text-xl font-black text-emerald-600 block mt-1.5">{formatCurrency(totalPromoComsEarned, globalCurrency)}</span>
                    <span className="text-[10px] text-emerald-800 bg-emerald-55 px-2 py-0.5 rounded-md font-bold mt-2 inline-block">Code {partnerPromoCode || 'Promo'}</span>
                  </div>

                  <div className="bg-slate-50 border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">Total Gain (Gross)</span>
                    <span className="text-xl font-black text-slate-800 block mt-1.5">{formatCurrency(grandTotalComs, globalCurrency)}</span>
                    <span className="text-[10px] text-slate-500 font-semibold mt-2 inline-block">Avoirs cumulés</span>
                  </div>

                  <div className="bg-rose-50 border border-rose-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                    <span className="text-[9px] text-rose-500 font-bold uppercase tracking-wider block">Déjà Reçu (Retraits)</span>
                    <span className="text-xl font-black text-rose-600 block mt-1.5">{formatCurrency(totalPartnerPayouts, globalCurrency)}</span>
                    <span className="text-[10px] text-rose-800 bg-rose-100/40 px-2 py-0.5 rounded-md font-bold mt-2 inline-block">Payé par l'Admin</span>
                  </div>

                  <div className="bg-emerald-950 text-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-emerald-900">
                    <span className="text-[9px] text-emerald-300 font-bold uppercase tracking-wider block">Solde Restant Dû</span>
                    <span className="text-2xl font-black text-emerald-400 block mt-1.5">{formatCurrency(remainingPartnerBalance, globalCurrency)}</span>
                    <span className="text-[10px] text-emerald-100 bg-emerald-900/40 px-2 py-0.5 rounded-md font-bold mt-2 inline-block">Reste à percevoir</span>
                  </div>
                </div>

                {/* Ledger Double-Table split view */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                  {/* Left: Sales list */}
                  <div className="bg-white border border-gray-150 rounded-2xl overflow-hidden shadow-sm space-y-4 p-6">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-black text-gray-900">Registre Historique des Ventes</h4>
                    </div>

                    {transLoading ? (
                      <div className="text-center py-10">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
                        <p className="text-xs text-gray-500 mt-2 font-medium">Chargement des transactions financières...</p>
                      </div>
                    ) : partnerTrans.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
                        <Coins className="w-10 h-10 text-gray-300 mx-auto" />
                        <p className="text-xs text-gray-400 italic mt-2 font-semibold">Aucune transaction enregistrée.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-150 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none">
                              <th className="px-3 py-2.5">Date</th>
                              <th className="px-3 py-2.5">Abonné</th>
                              <th className="px-3 py-2.5">Licence / Pack</th>
                              <th className="px-3 py-2.5 text-right">Com. Part</th>
                              <th className="px-3 py-2.5 text-right">Com. Promo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-gray-700 font-semibold font-sans">
                            {partnerTrans.map(t => (
                              <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-3 py-3 text-gray-400 font-mono text-[10px]">
                                  {t.date ? (t.date.toDate ? t.date.toDate().toLocaleDateString('fr-FR') : new Date(t.date).toLocaleDateString('fr-FR')) : 'N/A'}
                                </td>
                                <td className="px-3 py-3 text-gray-900 font-bold">
                                  {t.userDisplayName || t.username || `@${t.userId}`}
                                </td>
                                <td className="px-3 py-3 font-bold text-indigo-950">
                                  {t.licenseId}
                                </td>
                                <td className="px-3 py-3 text-indigo-600 font-extrabold text-right font-mono">
                                  {formatCurrency(Number(t.commissionPartner || 0), globalCurrency)}
                                </td>
                                <td className="px-3 py-3 text-emerald-700 font-extrabold text-right font-mono">
                                  {formatCurrency(Number(t.commissionPromo || t.promoCommission || 0), globalCurrency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Right: Payout list (Expenses logged under partnerId) */}
                  <div className="bg-white border border-gray-150 rounded-2xl overflow-hidden shadow-sm space-y-4 p-6">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-black text-gray-900">Registre des Règlements reversés par l'Admin</h4>
                    </div>

                    {partnerExpenses.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
                        <Coins className="w-10 h-10 text-gray-300 mx-auto" />
                        <p className="text-xs text-gray-400 italic mt-2 font-semibold">Aucun versement n'a encore été reversé pour votre compte.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-gray-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider select-none">
                              <th className="px-3 py-2.5">Date</th>
                              <th className="px-3 py-2.5">Justification règlement</th>
                              <th className="px-3 py-2.5 text-right">Montant versé</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-slate-700 font-semibold font-sans">
                            {partnerExpenses.map(exp => (
                              <tr key={exp.id} className="hover:bg-rose-50/10 transition-colors">
                                <td className="px-3 py-3 text-gray-400 font-mono text-[10px]">
                                  {exp.date ? (exp.date.toDate ? exp.date.toDate().toLocaleDateString('fr-FR') : new Date(exp.date).toLocaleDateString('fr-FR')) : 'N/A'}
                                </td>
                                <td className="px-3 py-3 text-slate-900 font-sans">
                                  <span className="block font-black text-rose-700 text-[9px] uppercase tracking-wider mb-0.5">
                                    {exp.motif === 'payement partenaire' ? 'Paiement Associé' : 'Com. Coupon'}
                                  </span>
                                  <span className="text-[10px] font-medium text-slate-500 line-clamp-1">{exp.description}</span>
                                </td>
                                <td className="px-3 py-3 text-right font-mono font-black text-rose-600 whitespace-nowrap">
                                  - {formatCurrency(exp.amount || 0, globalCurrency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB: ADMIN DÉLÉGUÉ */}
          {activeTab === 'admin' && (() => {
            const myPermissions = partnerProfile?.permissions || user?.permissions || [];
            const canManage = myPermissions.includes('manage_users') || myPermissions.includes('local_admin');

            return (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-black text-gray-900 leading-tight">Espace d'Administration Déléguée</h3>
                    <p className="text-gray-500 text-xs font-semibold mt-1">Vous disposez d'un accès sécurisé d'administration locale pour vos filières et licences assignées.</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-2xl px-4 py-2">
                    <ShieldAlert className="w-5 h-5" />
                    <span>Accès Délégué Activé</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                  {/* Left block - settings and credentials display */}
                  <div className="space-y-6">
                    <div className="bg-white border border-gray-150 rounded-2xl p-6 shadow-sm space-y-4">
                      <h4 className="text-sm font-black text-gray-900">Vos Droits et Permissions d'Accès</h4>
                      <p className="text-xs text-gray-400 font-medium leading-relaxed">Les droits d'accès délégués sont configurés et régis à distance par le Super Administrateur de la plateforme.</p>
                      
                      <div className="space-y-2 pt-2">
                        {[
                          { key: 'view_users', label: 'Consulter mes abonnés', desc: 'Permet de suivre son panel de parrainage.' },
                          { key: 'view_stats', label: 'Consulter les statistiques', desc: 'Accès graphique aux statistiques.' },
                          { key: 'view_finances', label: 'Accéder aux relevés financiers', desc: 'Consulter l\'historique des commissions.' },
                          { key: 'manage_users', label: 'Inscrire / Gérer les abonnés', desc: 'Inscrire directement des candidats.' },
                          { key: 'manage_content', label: 'Contrôle des cours et documents', desc: 'Autorisation d\'administration locale de contenu.' },
                          { key: 'create_exams', label: 'Générer des examens blancs', desc: 'Droits de conception d\'examens.' },
                          { key: 'local_admin', label: 'Administration Locale Générale', desc: 'Supervision maximale locale.' }
                        ].map(perm => {
                          const hasIt = myPermissions.includes(perm.key);
                          return (
                            <div key={perm.key} className={cn(
                              "flex items-start gap-3 p-3 rounded-xl border transition",
                              hasIt ? "bg-green-50/50 border-green-150" : "bg-gray-50 border-gray-100 opacity-60"
                            )}>
                              <div className={cn(
                                "w-4 h-4 rounded-full flex items-center justify-center mt-0.5",
                                hasIt ? "bg-green-500 text-white" : "bg-gray-300 text-gray-500"
                              )}>
                                {hasIt ? '✓' : '✗'}
                              </div>
                              <div>
                                <p className={cn("text-xs font-bold leading-tight", hasIt ? "text-green-950" : "text-gray-500")}>
                                  {perm.label}
                                </p>
                                <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{perm.desc}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right block - actions handler based on permissions */}
                  <div className="lg:col-span-2 space-y-6">
                    {canManage ? (
                      <div className="bg-white border border-gray-150 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                        <div className="border-b border-gray-100 pb-4">
                          <h4 className="text-lg font-black text-gray-900">Enregistrer un nouvel Abonné local</h4>
                          <p className="text-xs text-gray-400 font-semibold mt-1">Créez un compte temporaire ou d'abonnement pour une filière autorisée. La licence sera automatiquement rattachée à vos parrainages.</p>
                        </div>

                        <form onSubmit={handleCreateDelegatedUser} className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-extrabold text-gray-600 ml-1">Identifiant unique (Pseudo ou matricule)</label>
                              <input
                                type="text"
                                required
                                value={delegatedUserForm.username}
                                onChange={e => setDelegatedUserForm({ ...delegatedUserForm, username: e.target.value })}
                                placeholder="Indiquez un identifiant sans espace"
                                className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-extrabold text-gray-600 ml-1">Nom Complet du candidat</label>
                              <input
                                type="text"
                                required
                                value={delegatedUserForm.displayName}
                                onChange={e => setDelegatedUserForm({ ...delegatedUserForm, displayName: e.target.value })}
                                placeholder="Indiquez son nom et prénom"
                                className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-extrabold text-gray-600 ml-1">Mot de passe temporaire</label>
                              <input
                                type="password"
                                required
                                value={delegatedUserForm.password}
                                onChange={e => setDelegatedUserForm({ ...delegatedUserForm, password: e.target.value })}
                                placeholder="Fixez un mot de passe d'initialisation"
                                className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-extrabold text-gray-600 ml-1">Téléphone portable</label>
                              <input
                                type="text"
                                value={delegatedUserForm.phone}
                                onChange={e => setDelegatedUserForm({ ...delegatedUserForm, phone: e.target.value })}
                                placeholder="Ex: +237..."
                                className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                              />
                            </div>

                            <div className="space-y-1.5 col-span-1 sm:col-span-2">
                              <label className="text-xs font-extrabold text-gray-600 ml-1">Courrier Électronique (E-mail)</label>
                              <input
                                type="email"
                                required
                                value={delegatedUserForm.email}
                                onChange={e => setDelegatedUserForm({ ...delegatedUserForm, email: e.target.value })}
                                placeholder="Ex: candidat@compte.fr"
                                className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-extrabold text-gray-600 ml-1">Filière d'Étude</label>
                              <select
                                required
                                value={delegatedUserForm.filiere}
                                onChange={e => setDelegatedUserForm({ ...delegatedUserForm, filiere: e.target.value })}
                                className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                              >
                                <option value="">Choisir la filière</option>
                                <option value="medecine">Médecine</option>
                                <option value="ide">IDE</option>
                                <option value="sage_femme">Sage-femme</option>
                                <option value="kinetherapie">Kinésithérapie</option>
                                <option value="pharmacie">Pharmacie</option>
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-extrabold text-gray-600 ml-1">Durée initiale de l'Abonnement</label>
                              <select
                                value={delegatedUserForm.months}
                                onChange={e => setDelegatedUserForm({ ...delegatedUserForm, months: Number(e.target.value) })}
                                className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                              >
                                <option value={1}>1 Mois</option>
                                <option value={3}>3 Mois (Standard)</option>
                                <option value={6}>6 Mois</option>
                                <option value={12}>12 Mois (Annuel)</option>
                              </select>
                            </div>
                          </div>

                          {delegatedMsg && (
                            <div className={cn(
                              "p-3 rounded-xl block text-xs font-bold border",
                              delegatedMsg.type === 'success' ? "bg-green-50 border-green-150 text-green-700" : "bg-red-50 border-red-150 text-red-700"
                            )}>
                              {delegatedMsg.text}
                            </div>
                          )}

                          <div className="flex justify-end pt-2">
                            <button
                              type="submit"
                              disabled={delegatedLoading}
                              className="px-6 py-2.5 bg-indigo-600 text-white font-black text-xs rounded-xl hover:bg-indigo-700 transition shadow-md disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {delegatedLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                              Inscrire l'abonné
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <div className="bg-white border border-gray-150 rounded-2xl p-10 text-center space-y-3 shadow-sm">
                        <Lock className="w-10 h-10 text-gray-300 mx-auto" />
                        <h4 className="text-sm font-black text-gray-800">Abonnements Restreints</h4>
                        <p className="text-xs text-gray-400 font-semibold leading-relaxed">
                          Votre profil Partenaire ne dispose pas des droits de création de comptes délégués.
                          Veuillez contacter le Super Administrateur si vous devez enregistrer manuellement des élèves rattachés.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 4: PROFILE & FORM EDIT */}
          {activeTab === 'profile' && (
            <div className="space-y-8 animate-in fade-in duration-300 max-w-2xl">
              <h3 className="text-xl font-extrabold text-indigo-950">Gérer mon profil Partenaire</h3>

              <div className="bg-white border border-gray-150 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <form onSubmit={handleUpdateProfile} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-1 sm:col-span-2">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">Pseudo de connexion</p>
                      <p className="font-mono text-sm text-gray-900 bg-gray-100 p-3 rounded-lg border border-gray-200 select-all select-none">
                        @{user.username}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-extrabold text-gray-600 ml-1">Nom Complet</label>
                      <input
                        type="text"
                        required
                        value={profileForm.displayName}
                        onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                        placeholder="Votre nom"
                        className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-extrabold text-gray-600 ml-1">Téléphone de Contact</label>
                      <input
                        type="text"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                        placeholder="Ex: +2376xxxxxxxx"
                        className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                      />
                    </div>

                    <div className="space-y-1.5 col-span-1 sm:col-span-2">
                      <label className="text-xs font-extrabold text-gray-600 ml-1">Courrier Électronique (Email)</label>
                      <input
                        type="email"
                        required
                        value={profileForm.email}
                        onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                        placeholder="votre@adresse.email"
                        className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-600 transition"
                      />
                    </div>
                  </div>

                  {statusMessage && (
                    <div className={cn(
                      "flex items-center gap-2 p-3 text-xs font-bold rounded-xl border",
                      statusMessage.type === 'success' ? "bg-green-50 border-green-150 text-green-700" : "bg-red-50 border-red-150 text-red-700"
                    )}>
                      {statusMessage.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <ShieldAlert className="w-4 h-4 flex-shrink-0" />}
                      <p>{statusMessage.text}</p>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={editLoading}
                      className="px-6 py-2.5 bg-indigo-605 text-white bg-indigo-600 hover:bg-indigo-700 text-xs font-black rounded-xl transition shadow-md disabled:opacity-50"
                    >
                      {editLoading ? <Loader2 className="w-4 h-4 animate-spin inline-block mr-1" /> : null}
                      Enregistrer les modifications
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL: RATES & FINANCIAL PERCENTAGES */}
      <AnimatePresence>
        {isRatesModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto font-sans" id="rates-modal">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsRatesModalOpen(false)}
                className="fixed inset-0 transition-opacity bg-gray-900/60 backdrop-blur-[2px]"
              />

              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ duration: 0.25 }}
                className="inline-block w-full max-w-4xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-2xl rounded-3xl border border-gray-105 sm:p-8"
              >
                <div className="flex items-start justify-between pb-5 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="p-3.5 bg-indigo-50 rounded-2xl text-indigo-600">
                      <Coins className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-gray-900 leading-none">Grille Financière des Commissions</h3>
                      <p className="text-xs text-gray-400 font-bold mt-1.5">Consultez vos différents pourcentages et les gains calculés sur vos licences autorisées.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsRatesModalOpen(false)}
                    className="p-1.5 hover:bg-gray-100 rounded-xl transition text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Informational Banner */}
                <div className="mt-6 p-4 bg-slate-50 border border-slate-150 rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold text-slate-700 leading-relaxed">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 rounded-full bg-indigo-600 mt-1.5 shrink-0" />
                    <div>
                      <span className="font-black text-indigo-950 block uppercase tracking-wide text-[10px]">Commission Code Promo</span>
                      Appliquée automatiquement lors de l'inscription d'un abonné par votre code de parrainage.
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
                    <div>
                      <span className="font-black text-emerald-950 block uppercase tracking-wide text-[10px]">Commission Rattachement Associé</span>
                      Appliquée lorsque vous disposez des droits statistiques exclusifs ou êtes rattaché manuellement.
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-6 max-h-[50vh] overflow-y-auto pr-1">
                  {(() => {
                    const allowedFils = partnerConfig?.allowedFilieres || [];
                    const allowedLics = partnerConfig?.allowedLicences || [];

                    const displayedRates = licenseParamsList.filter(lic => {
                      // general access or explicit access
                      const hasGeneralAccess = allowedFils.length === 0 && allowedLics.length === 0;

                      const matchesFiliere = allowedFils.some(fId => {
                        const fIdLow = fId.trim().toLowerCase();
                        const licIdLow = lic.id.trim().toLowerCase();
                        const licNameLow = (lic.name || '').trim().toLowerCase();
                        return licIdLow.includes(fIdLow) || fIdLow.includes(licIdLow) || licNameLow.includes(fIdLow);
                      });

                      const matchesLicence = allowedLics.some(lId => {
                        const lIdLow = lId.trim().toLowerCase();
                        const licIdLow = lic.id.trim().toLowerCase();
                        return licIdLow.includes(lIdLow) || lIdLow.includes(licIdLow);
                      });

                      const isAuthorized = hasGeneralAccess || matchesFiliere || matchesLicence;

                      const countPromo = promoSubscribers.filter(st => (st.filiere || '').toUpperCase().trim() === lic.id.toUpperCase().trim()).length;
                      const countRattache = rattachés.filter(st => {
                        const filMatched = (st.filiere || '').toUpperCase().trim() === lic.id.toUpperCase().trim();
                        const isNotPromo = !promoSubscribers.some(p => p.id === st.id);
                        return filMatched && isNotPromo;
                      }).length;

                      const totalSubscribersForLic = countPromo + countRattache;

                      return isAuthorized && totalSubscribersForLic > 0;
                    });

                    if (displayedRates.length === 0) {
                      return (
                        <div className="text-center py-10 border border-dashed border-gray-200 rounded-3xl bg-gray-50/50">
                          <Coins className="w-12 h-12 text-gray-300 mx-auto animate-pulse" />
                          <p className="text-sm font-bold text-gray-700 mt-3">Aucune licence active trouvée</p>
                          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto leading-relaxed font-semibold">
                            Vous n'avez pas d'abonnés enregistrés ou votre compte ne dispose pas encore d'autorisations de licences avec des abonnés actifs associés.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-4">
                        {displayedRates.map(lic => {
                          const countPromo = promoSubscribers.filter(st => (st.filiere || '').toUpperCase().trim() === lic.id.toUpperCase().trim()).length;
                          const countRattache = rattachés.filter(st => {
                            const filMatched = (st.filiere || '').toUpperCase().trim() === lic.id.toUpperCase().trim();
                            const isNotPromo = !promoSubscribers.some(p => p.id === st.id);
                            return filMatched && isNotPromo;
                          }).length;

                          return (
                            <div key={lic.id} className="border border-gray-150 p-5 rounded-2xl bg-white hover:border-indigo-200 transition-all shadow-xs space-y-4">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-black text-slate-900">{lic.name || lic.id}</span>
                                  <span className="bg-slate-100 text-slate-700 font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide border border-slate-200">
                                    {lic.id}
                                  </span>
                                </div>
                                <div className="flex gap-2 text-[10px] font-bold">
                                  <span className="text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-lg">
                                    {countPromo} Code Promo
                                  </span>
                                  <span className="text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg">
                                    {countRattache} Rattaché{countRattache > 1 ? 's' : ''}
                                  </span>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Section commissions */}
                                <div className="bg-gradient-to-br from-gray-50 to-slate-50/50 p-3.5 rounded-xl border border-gray-150 space-y-2">
                                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider font-mono font-semibold">Taux Accordés</p>
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-gray-500 font-semibold">Code Promo :</span>
                                    <span className="font-extrabold text-indigo-600">{lic.promoCommission}%</span>
                                  </div>
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-gray-500 font-semibold">Associé Directeur :</span>
                                    <span className="font-extrabold text-emerald-600">{lic.partnerCommission}%</span>
                                  </div>
                                </div>

                                {/* Section pricing */}
                                <div className="bg-gradient-to-br from-gray-50 to-slate-50/50 p-3.5 rounded-xl border border-gray-150 space-y-2 col-span-1 md:col-span-2">
                                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider font-mono font-semibold">Grille Référence</p>
                                  <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="bg-white p-1 rounded border border-gray-100">
                                      <p className="text-[8px] text-gray-400 font-semibold uppercase">3 Mois</p>
                                      <p className="text-[11px] font-black text-slate-800 mt-0.5">{formatCurrency(lic.price3m, globalCurrency)}</p>
                                    </div>
                                    <div className="bg-white p-1 rounded border border-gray-100">
                                      <p className="text-[8px] text-gray-400 font-semibold uppercase">6 Mois</p>
                                      <p className="text-[11px] font-black text-slate-800 mt-0.5">{formatCurrency(lic.price6m, globalCurrency)}</p>
                                    </div>
                                    <div className="bg-white p-1 rounded border border-gray-100">
                                      <p className="text-[8px] text-gray-400 font-semibold uppercase">12 Mois</p>
                                      <p className="text-[11px] font-black text-slate-800 mt-0.5">{formatCurrency(lic.price12m, globalCurrency)}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Dynamic Simulator */}
                              <div className="bg-indigo-50/30 border border-indigo-100/50 p-3 rounded-xl text-xs font-semibold text-slate-700 space-y-2">
                                <p className="text-[9px] text-indigo-600 font-black uppercase tracking-widest font-mono">Simulateur de Gain (Exemple sur 12 Mois)</p>
                                <div className="flex flex-col sm:flex-row justify-between gap-3 pt-1">
                                  <div className="flex justify-between items-center w-full bg-white/75 px-3 py-1.5 rounded-lg border border-slate-100">
                                    <span className="text-gray-500 font-semibold">Gain Promo (Abonné) :</span>
                                    <span className="font-extrabold text-indigo-700">{formatCurrency(Math.round(lic.price12m * lic.promoCommission / 100 * 100) / 100, globalCurrency)}</span>
                                  </div>
                                  <div className="flex justify-between items-center w-full bg-white/75 px-3 py-1.5 rounded-lg border border-slate-100">
                                    <span className="text-gray-500 font-semibold">Gain Associé (Rattaché) :</span>
                                    <span className="font-extrabold text-emerald-700">{formatCurrency(Math.round(lic.price12m * lic.partnerCommission / 100 * 100) / 100, globalCurrency)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex justify-end pt-5 mt-6 border-t border-gray-100">
                  <button
                    onClick={() => setIsRatesModalOpen(false)}
                    className="px-5 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 transition text-xs font-black rounded-xl"
                  >
                    Fermer
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
