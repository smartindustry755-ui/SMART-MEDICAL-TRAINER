import React, { useState, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Upload, FileText, CheckCircle, AlertCircle, Trash2, Eye, FileUp, Image as ImageIcon, Plus, LayoutGrid, ChevronDown, ChevronUp, Loader2, Book, Settings, ChevronRight, Wand2, Menu, X, LogOut, ArrowLeft, GraduationCap, Users, Coins, Award } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, safeLocalStorage } from '../lib/utils';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import AdminExamManager from './AdminExamManager.tsx';
import Gallery from './Gallery.tsx';
import BlockManagementView from './BlockManagementView.tsx';
import ImportView from './ImportView.tsx';
import AutoMergeMaintenanceView from './AutoMergeMaintenanceView.tsx';
import UserManagementView from './UserManagementView.tsx';
import SettingsView from './SettingsView.tsx';
import FinancialSettingsView from './FinancialSettingsView.tsx';
import LicenceView from './LicenceView.tsx';

export default function AdminInterface({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const savedUser = safeLocalStorage.getItem('ais_user');
  const [user, setUser] = useState(savedUser ? JSON.parse(savedUser) : null);
  const [adminView, setAdminView] = useState<'import' | 'gallery' | 'blocks' | 'maintenance' | 'exams' | 'users' | 'settings' | 'finances_admin' | 'licence'>('gallery');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  React.useEffect(() => {
    if (!user) return;
    setLoading(true);
    const q = query(collection(db, 'books'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setBooks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'books');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-full bg-transparent overflow-y-auto flex-col md:flex-row relative">
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isSidebarOpen && window.innerWidth < 768 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[90] md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar (Desktop & Mobile) */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isSidebarOpen ? 280 : (window.innerWidth < 768 ? 0 : 80),
          x: isSidebarOpen ? 0 : (window.innerWidth < 768 ? -280 : 0),
          opacity: isSidebarOpen ? 1 : (window.innerWidth < 768 ? 0 : 1)
        }}
        className={cn(
          "bg-white border-r border-gray-200/60 shadow-xl shadow-blue-900/5 flex-col z-[100]",
          "fixed md:relative top-0 left-0 bottom-0 h-full overflow-y-auto"
        )}
      >
        <div className="p-6 flex items-center justify-between border-b border-gray-100">
          <AnimatePresence mode="wait">
            {isSidebarOpen ? (
              <motion.div 
                key="logo-full"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-3 overflow-hidden whitespace-nowrap"
              >
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
              </motion.div>
            ) : (
              <motion.div 
                key="logo-mini"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="mx-auto"
              >
                <div className="w-10 h-10 relative">
                  <img 
                    src="/logo.jpg" 
                    alt="Smart Tutor Logo" 
                    className="w-full h-full object-contain filter drop-shadow-[0_4px_8px_rgba(165,180,252,0.15)] rounded-lg"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          {isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
          {!isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="w-full p-3 flex justify-center hover:bg-blue-50 text-blue-600 rounded-xl transition-all mb-4"
            >
              <Menu className="w-6 h-6" />
            </button>
          )}

          {[
            { id: 'gallery', label: 'Galerie', icon: ImageIcon },
            { id: 'import', label: 'Importation', icon: Upload },
            { id: 'blocks', label: 'Gestion des blocs', icon: LayoutGrid },
            { id: 'exams', label: 'Examens Blancs', icon: GraduationCap },
            { id: 'users', label: 'Utilisateurs', icon: Users },
            { id: 'licence', label: 'Licence', icon: Award },
            { id: 'finances_admin', label: 'Paramètres Financiers', icon: Coins },
            { id: 'settings', label: 'Paramètres', icon: Settings },
            { id: 'maintenance', label: 'Maintenance', icon: Wand2 },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setAdminView(item.id as any)}
              title={!isSidebarOpen ? item.label : undefined}
              className={cn(
                "w-full flex items-center gap-4 p-3.5 rounded-2xl transition-all group relative",
                adminView === item.id 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <item.icon className={cn("w-5 h-5 flex-shrink-0", adminView === item.id ? "text-white" : "group-hover:text-blue-600")} />
              {isSidebarOpen && (
                <motion.span 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="font-bold whitespace-nowrap"
                >
                  {item.label}
                </motion.span>
              )}
              {!isSidebarOpen && adminView === item.id && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-l-full" />
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100 space-y-2">
          <button
            onClick={() => navigate('/')}
            title={!isSidebarOpen ? "Tableau de Bord" : undefined}
            className={cn(
              "w-full flex items-center gap-4 p-3.5 rounded-2xl transition-all group relative",
              "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            <LayoutGrid className="w-5 h-5 flex-shrink-0 group-hover:text-blue-600" />
            {isSidebarOpen && (
              <motion.span 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-bold whitespace-nowrap"
              >
                Tableau de Bord
              </motion.span>
            )}
          </button>
          <div className={cn(
            "flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden",
            !isSidebarOpen && "justify-center"
          )}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-blue-600 font-bold flex-shrink-0">
              {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'A'}
            </div>
            {isSidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{user?.displayName || user?.username || 'Admin'}</p>
                <button 
                  onClick={onLogout}
                  className="text-[10px] font-bold text-red-500 uppercase tracking-widest hover:text-red-600 transition-colors flex items-center gap-1"
                >
                  <LogOut className="w-3 h-3" /> Déconnexion
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Mobile Header */}
      <header className="md:hidden bg-white/80 backdrop-blur-md border-b border-gray-200 p-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="p-2 bg-blue-600 rounded-xl shadow-sm shadow-blue-200">
            <Settings className="w-5 h-5 text-white" />
          </div>
          <span className="font-display font-bold text-lg text-gray-900">Admin</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            title="Tableau de Bord"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button 
            onClick={onLogout}
            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto h-auto max-h-[100vh] custom-scrollbar pb-24 md:pb-8 pt-2">
        <div className="max-w-6xl mx-auto p-4 md:p-10 space-y-6 md:space-y-10">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-gray-900 tracking-tight">
                {adminView === 'gallery' && "Galerie des Contenus"}
                {adminView === 'import' && "Importation de Données"}
                {adminView === 'blocks' && "Gestion des Blocs"}
                {adminView === 'exams' && "Examens Blancs"}
                {adminView === 'users' && "Gestion des Utilisateurs"}
                {adminView === 'licence' && "Gestion des Licences & Filières"}
                {adminView === 'finances_admin' && "Paramètres Financiers"}
                {adminView === 'settings' && "Paramètres du Contenu"}
                {adminView === 'maintenance' && "Maintenance Système"}
              </h1>
              <p className="text-gray-500 mt-1">
                {adminView === 'gallery' && "Consultez et gérez les livres et chapitres existants"}
                {adminView === 'import' && "Ajoutez de nouvelles banques de questions à la base"}
                {adminView === 'blocks' && "Modifiez les titres et l'organisation des blocs"}
                {adminView === 'exams' && "Programmez et gérez les examens blancs"}
                {adminView === 'users' && "Gérez les accès et les rôles des utilisateurs"}
                {adminView === 'licence' && "Gérez dynamiquement vos filières d'études et formats de licence de la plateforme"}
                {adminView === 'finances_admin' && "Gérez les formules tarifaires, commissions de parrainage et historique comptable global"}
                {adminView === 'settings' && "Gérez les livres, chapitres et blocs avec recherche avancée"}
                {adminView === 'maintenance' && "Outils d'optimisation et de nettoyage de la base"}
              </p>
            </div>
          </header>

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {adminView === 'import' && <ImportView />}
            {adminView === 'blocks' && <BlockManagementView books={books} />}
            {adminView === 'gallery' && <Gallery books={books} setStatus={setStatus} loading={loading} />}
            {adminView === 'exams' && <AdminExamManager />}
            {adminView === 'users' && <UserManagementView />}
            {adminView === 'licence' && <LicenceView />}
            {adminView === 'finances_admin' && <FinancialSettingsView />}
            {adminView === 'settings' && <SettingsView />}
            {adminView === 'maintenance' && <AutoMergeMaintenanceView />}
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 flex gap-1 p-2 pb-safe overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none] snap-x justify-start select-none">
        {[
          { id: 'gallery', label: 'Galerie', icon: ImageIcon },
          { id: 'import', label: 'Import', icon: Upload },
          { id: 'blocks', label: 'Blocs', icon: LayoutGrid },
          { id: 'exams', label: 'Examens', icon: GraduationCap },
          { id: 'users', label: 'Users', icon: Users },
          { id: 'licence', label: 'Licence', icon: Award },
          { id: 'finances_admin', label: 'Finances', icon: Coins },
          { id: 'settings', label: 'Param.', icon: Settings },
          { id: 'maintenance', label: 'Maint.', icon: Wand2 },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setAdminView(item.id as any)}
            className={cn(
              "flex flex-col items-center justify-center p-2 rounded-xl transition-all min-w-[68px] flex-shrink-0 snap-center",
              adminView === item.id 
                ? "text-blue-600" 
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <div className={cn(
              "p-1.5 rounded-lg mb-1 transition-colors",
              adminView === item.id ? "bg-blue-50" : "bg-transparent"
            )}>
              <item.icon className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
