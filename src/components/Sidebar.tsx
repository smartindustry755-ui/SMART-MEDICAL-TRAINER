import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutGrid, Book, TrendingUp, Target, Calendar, Award, X, Settings, GraduationCap, HelpCircle, FileText, Coins, ShieldAlert } from 'lucide-react';
import { cn, safeLocalStorage } from '../lib/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, onSnapshot } from '../lib/firebase';
import { doc } from 'firebase/firestore';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onLogout?: () => void;
  onRestartTutorial?: () => void;
  onSwitchToPartnerSpace?: () => void;
}

export default function Sidebar({ isOpen, onClose, isAdmin, onLogout, onRestartTutorial, onSwitchToPartnerSpace }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  
  const savedUser = safeLocalStorage.getItem('ais_user');
  const user = savedUser ? JSON.parse(savedUser) : null;

  const [partnerProfile, setPartnerProfile] = useState<any>(null);

  useEffect(() => {
    if (user?.role === 'partner' && (user?.id || user?.username)) {
      const docRef = doc(db, 'users', user.id || user.username);
      const unsub = onSnapshot(docRef, (snap) => {
        if (snap.exists()) {
          setPartnerProfile(snap.data());
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.id || user.username}`);
      });
      return () => unsub();
    }
  }, [user?.role, user?.id, user?.username]);

  const partnerMode = (user?.role === 'partner' || user?.role === 'apporteur') ? (safeLocalStorage.getItem('ais_partner_mode') || 'partner') : 'student';

  let menuItems = [];
  if ((user?.role === 'partner' || user?.role === 'apporteur') && partnerMode === 'partner') {
    if (user?.role === 'apporteur') {
      menuItems = [
        { id: 'partner_dashboard', path: '/partner/dashboard', title: 'Tableau de Bord', icon: <LayoutGrid className="w-5 h-5" />, color: 'text-gray-650' },
        { id: 'partner_profile', path: '/partner/profile', title: 'Mon profil', icon: <Settings className="w-5 h-5" />, color: 'text-slate-600' }
      ];
    } else {
      menuItems = [
        { id: 'partner_dashboard', path: '/partner/dashboard', title: 'Tableau de Bord', icon: <LayoutGrid className="w-5 h-5" />, color: 'text-gray-650' },
        { id: 'partner_users', path: '/partner/users', title: 'Mes utilisateurs', icon: <Book className="w-5 h-5" />, color: 'text-blue-600' },
        { id: 'partner_stats', path: '/partner/stats', title: 'Statistiques', icon: <TrendingUp className="w-5 h-5" />, color: 'text-indigo-650' },
        { id: 'partner_finances', path: '/partner/finances', title: 'Mes Finances', icon: <Coins className="w-5 h-5" />, color: 'text-emerald-600' },
      ];

      // If hasAdminAccess, map the delegate admin section
      if (partnerProfile?.hasAdminAccess || user?.hasAdminAccess) {
        menuItems.push({ id: 'partner_admin', path: '/partner/admin', title: 'Admin Délégué', icon: <ShieldAlert className="w-5 h-5" />, color: 'text-rose-600' });
      }

      menuItems.push({ id: 'partner_profile', path: '/partner/profile', title: 'Mon profil', icon: <Settings className="w-5 h-5" />, color: 'text-slate-600' });
    }
  } else {
    menuItems = [
      { id: 'dashboard', path: '/', title: 'Tableau de Bord', icon: <LayoutGrid className="w-5 h-5" />, color: 'text-gray-600' },
      { id: 'training', path: '/training', title: 'Entraînement', icon: <Book className="w-5 h-5" />, color: 'text-indigo-600' },
      { id: 'simulation', path: '/simulation', title: 'Simulation', icon: <Target className="w-5 h-5" />, color: 'text-amber-600' },
      { id: 'planning', path: '/planning', title: 'Planification', icon: <Calendar className="w-5 h-5" />, color: 'text-emerald-600' },
      { id: 'progression', path: '/progression', title: 'Progression', icon: <TrendingUp className="w-5 h-5" />, color: 'text-blue-600' },
      { id: 'revision', path: '/revision', title: 'Révision', icon: <FileText className="w-5 h-5" />, color: 'text-purple-600' },
      { id: 'errors', path: '/errors', title: 'Mes erreurs', icon: <X className="w-5 h-5" />, color: 'text-red-600' },
      { id: 'settings', path: '/settings', title: 'Paramètres', icon: <Settings className="w-5 h-5" />, color: 'text-slate-600' },
    ];
    if (isAdmin) {
      menuItems.push({ id: 'admin', path: '/admin', title: 'Administration', icon: <Settings className="w-5 h-5" />, color: 'text-rose-600' });
    }
    if ((user?.role === 'partner' || user?.role === 'apporteur') && partnerMode === 'student') {
      menuItems.push({ 
        id: 'partner_space_back', 
        path: '/partner-space-back', 
        title: user?.role === 'apporteur' ? 'Mon Espace Apporteur' : 'Mon Espace Partenaire', 
        icon: <Award className="w-5 h-5 animate-pulse" />, 
        color: 'text-indigo-600 font-extrabold' 
      });
    }
  }

  const handleNavigation = (path: string) => {
    if (path === '/partner-space-back') {
      if (onSwitchToPartnerSpace) {
        onSwitchToPartnerSpace();
      }
      onClose();
      return;
    }
    navigate(path);
    onClose();
  };

  return (
    <>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar Panel */}
      <motion.aside
        initial={false}
        animate={{ 
          width: isOpen ? 280 : 0,
          opacity: isOpen ? 1 : (window.innerWidth < 768 ? 0 : 1),
          x: isOpen ? 0 : (window.innerWidth < 768 ? -280 : 0)
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={cn(
          "bg-white border-r border-gray-100 z-[110] flex flex-col overflow-hidden transition-all duration-300 h-full",
          "fixed md:relative top-0 left-0 bottom-0",
          isOpen ? "shadow-2xl md:shadow-none" : "w-0 border-none md:w-0"
        )}
      >
        <div className="p-6 border-b border-gray-50 flex items-center justify-between min-w-[280px]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 relative">
              <img 
                src="/logo.jpg" 
                alt="Smart Tutor Logo" 
                className="w-full h-full object-contain filter drop-shadow-[0_4px_8px_rgba(165,180,252,0.15)] rounded-lg"
                referrerPolicy="no-referrer"
              />
            </div>
            <span className="font-display font-black text-xl tracking-tight bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-transparent">
              Smart Tutor
            </span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

         <nav className="flex-1 p-4 space-y-2 overflow-y-auto min-w-[280px]">
          {menuItems.map((item) => {
            const isPartnerActiveMode = user?.role === 'partner' && partnerMode === 'partner';
            const isActive = isPartnerActiveMode
              ? (item.id === 'partner_dashboard' ? (location.pathname === '/' || location.pathname === '/partner' || location.pathname === '/partner/dashboard') : location.pathname.startsWith(item.path))
              : (item.id === 'simulation' 
                ? (location.pathname.startsWith('/simulation') || location.pathname.startsWith('/exams'))
                : (item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)));
            
            return (
              <button
                key={item.id}
                onClick={() => handleNavigation(item.path)}
                className={cn(
                  "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-200 group",
                  isActive 
                    ? "bg-indigo-50 text-indigo-700 shadow-sm" 
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <div className={cn(
                  "p-2 rounded-xl transition-colors",
                  isActive ? "bg-white shadow-sm" : "bg-gray-50 group-hover:bg-white",
                  isActive ? item.color : "text-gray-400 group-hover:text-gray-600"
                )}>
                  {item.icon}
                </div>
                <span className="font-bold">{item.title}</span>
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-600" />}
              </button>
            );
          })}
        </nav>

        <div className="p-6 border-t border-gray-50 bg-gray-50/50 min-w-[280px]">
          <div className="flex flex-col gap-3">
            {user?.role !== 'partner' && onRestartTutorial && (
              <button 
                onClick={onRestartTutorial}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all border border-indigo-100 mb-2"
              >
                <HelpCircle className="w-4 h-4" />
                Voir le guide
              </button>
            )}
            <div className="flex items-center gap-4 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-black">
                {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{user?.displayName || user?.username || 'Utilisateur'}</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    {user?.role === 'partner' ? 'Partenaire' : (user?.role === 'apporteur' ? 'Apporteur' : (isAdmin ? 'Admin' : 'Étudiant'))}
                  </p>
                  <span className="w-1 h-1 rounded-full bg-gray-300" />
                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest truncate">
                    {user?.role === 'partner' || user?.role === 'apporteur' ? user?.promoCode?.toUpperCase() || 'PROMO' : `${user?.filiere || 'ECN'} ${user?.niveau || 'ALL'}`}
                  </p>
                </div>
              </div>
            </div>
            {onLogout && (
              <button 
                onClick={onLogout}
                className="w-full py-2.5 text-xs font-bold text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all border border-transparent hover:border-red-100"
              >
                Se déconnecter
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}
