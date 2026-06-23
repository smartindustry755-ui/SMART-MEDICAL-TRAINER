import React, { useState, useEffect } from 'react';
import { 
  UserPlus, Users, Shield, GraduationCap, Trash2, Search, Loader2, Key, 
  CheckCircle2, AlertCircle, X, BarChart3, Trophy, PlayCircle, Clock, History, 
  Calendar, Phone, Edit3, ShieldAlert, Database, ChevronLeft, ToggleLeft, ToggleRight, 
  UserCheck, Timer, Award, CheckCircle, Briefcase, Mail, Coins, ArrowUpDown, Filter, Activity, TrendingUp
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, query, onSnapshot, doc, setDoc, deleteDoc, updateDoc, 
  serverTimestamp, orderBy, limit, getDoc, getDocs, where, addDoc 
} from 'firebase/firestore';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { FILIERES, FILIERE_OPTIONS, getLevelsForFiliere } from '../lib/constants';
import { recordFinancialTransaction, formatCurrency, LicenseParams, DEFAULT_LICENSE_PARAMS } from '../lib/finances';

export const PARTNER_FILIERES = [
  { id: 'ECN', name: 'Médecine (ECN)' },
  { id: 'IDE', name: 'IDE (Infirmier)' },
  { id: 'EM', name: 'Études Médicales (EM)' },
  { id: 'SF', name: 'Sage-femme' },
  { id: 'KINE', name: 'Kinésithérapie' },
  { id: 'PHARMA', name: 'Pharmacie' },
  { id: 'ALL', name: 'Toutes filières' }
];

export const formatSize = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 Ko';
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} Ko`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} Mo`;
};

interface TrendPoint {
  date: string;
  reads: number;
  writes: number;
  readBytes?: number;
  writeBytes?: number;
}

const SVGTrendChart = ({ data }: { data: TrendPoint[] }) => {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  
  if (!data || data.length === 0) return null;
  
  const width = 600;
  const height = 240;
  const paddingLeft = 50;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 40;
  
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  
  // Find max value for scaling
  let maxVal = 10;
  data.forEach((d: TrendPoint) => {
    if (d.reads > maxVal) maxVal = d.reads;
    if (d.writes > maxVal) maxVal = d.writes;
  });
  maxVal = Math.ceil(maxVal * 1.15); // Add 15% safety margin
  
  // Coordinate helper
  const getCoordinates = (reads: number, writes: number, index: number) => {
    const x = paddingLeft + (index / (data.length - 1)) * chartWidth;
    const yReads = paddingTop + chartHeight - (reads / maxVal) * chartHeight;
    const yWrites = paddingTop + chartHeight - (writes / maxVal) * chartHeight;
    return { x, yReads, yWrites };
  };
  
  const points = data.map((d: TrendPoint, idx: number) => getCoordinates(d.reads, d.writes, idx));
  
  // SVG Path generator
  let pathReads = "";
  let pathWrites = "";
  let areaReads = "";
  let areaWrites = "";
  
  if (points.length > 0) {
    // Standard Lines
    pathReads = `M ${points[0].x} ${points[0].yReads} ` + points.slice(1).map(p => `L ${p.x} ${p.yReads}`).join(" ");
    pathWrites = `M ${points[0].x} ${points[0].yWrites} ` + points.slice(1).map(p => `L ${p.x} ${p.yWrites}`).join(" ");
    
    // Filled Areas (starts at start of list, goes to end, drops down to bottom, goes back to start)
    areaReads = pathReads + ` L ${points[points.length-1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;
    areaWrites = pathWrites + ` L ${points[points.length-1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;
  }
  
  return (
    <div className="relative bg-[#fafafb]/50 border border-gray-100 p-5 rounded-3xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h5 className="font-extrabold text-sm text-indigo-950 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-indigo-600" /> Analyse de Charge Base de Données & App Hosting
          </h5>
          <p className="text-[11px] text-gray-500 font-medium">Tendances d'utilisation cumulée par jour - Lectures vs Écritures & Transfert (App Hosting)</p>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-extrabold uppercase tracking-wide">
          <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 block animate-pulse"></span>
            <span>Lectures</span>
          </div>
          <div className="flex items-center gap-1.5 bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 block animate-pulse"></span>
            <span>Écritures</span>
          </div>
        </div>
      </div>
      
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[500px]">
          <defs>
            <linearGradient id="colorReads" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.12}/>
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0}/>
            </linearGradient>
            <linearGradient id="colorWrites" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#d97706" stopOpacity={0.12}/>
              <stop offset="95%" stopColor="#d97706" stopOpacity={0.0}/>
            </linearGradient>
          </defs>
          
          {/* Y Axis Grid Lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = paddingTop + ratio * chartHeight;
            const valLabel = Math.round(maxVal * (1 - ratio));
            return (
              <g key={idx}>
                <line 
                  x1={paddingLeft} 
                  y1={y} 
                  x2={width - paddingRight} 
                  y2={y} 
                  stroke="#f1f5f9" 
                  strokeWidth={1}
                />
                <text 
                  x={paddingLeft - 8} 
                  y={y + 3.5} 
                  textAnchor="end" 
                  className="fill-gray-400 font-mono text-[9px] font-bold"
                >
                  {valLabel}
                </text>
              </g>
            );
          })}
          
          {/* Custom paths with gradients */}
          {points.length > 0 && (
            <>
              {/* Areas */}
              <path d={areaReads} fill="url(#colorReads)" />
              <path d={areaWrites} fill="url(#colorWrites)" />
              
              {/* Stroke Lines */}
              <path 
                d={pathReads} 
                fill="none" 
                stroke="#2563eb" 
                strokeWidth={2.5} 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className="opacity-90"
              />
              <path 
                d={pathWrites} 
                fill="none" 
                stroke="#d97706" 
                strokeWidth={2.5} 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className="opacity-90"
              />
              
              {/* Interactive Hover Dots */}
              {points.map((p, idx) => (
                <g 
                   key={idx} 
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  {/* Invisible wide interactive column */}
                  <rect 
                    x={p.x - 15} 
                    y={paddingTop} 
                    width={30} 
                    height={chartHeight} 
                    fill="transparent" 
                  />
                  
                  {/* Active day indicator line */}
                  {hoveredIdx === idx && (
                    <line 
                      x1={p.x} 
                      y1={paddingTop} 
                      x2={p.x} 
                      y2={paddingTop + chartHeight} 
                      stroke="#cbd5e1" 
                      strokeWidth={1.5} 
                      strokeDasharray="3 3"
                    />
                  )}
                  
                  {/* Reads circles */}
                  <circle 
                    cx={p.x} 
                    cy={p.yReads} 
                    r={hoveredIdx === idx ? 6 : 3.5} 
                    fill="white" 
                    stroke="#2563eb" 
                    strokeWidth={2.5}
                  />
                  
                  {/* Writes circles */}
                  <circle 
                    cx={p.x} 
                    cy={p.yWrites} 
                    r={hoveredIdx === idx ? 6 : 3.5} 
                    fill="white" 
                    stroke="#d97706" 
                    strokeWidth={2.5}
                  />
                </g>
              ))}
            </>
          )}
          
          {/* X Axis Date Labels */}
          {data.map((d, idx) => {
            const x = paddingLeft + (idx / (data.length - 1)) * chartWidth;
            // Format YYYY-MM-DD -> DD/MM
            const parts = d.date.split('-');
            const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : d.date;
            return (
              <text 
                key={idx} 
                x={x} 
                y={height - paddingBottom + 16} 
                textAnchor="middle" 
                className="fill-gray-500 font-bold text-[9px] tracking-wider"
              >
                {displayDate}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Embedded tooltip information */}
      <AnimatePresence>
        {hoveredIdx !== null && (
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="mt-3 p-3 bg-white border border-gray-150 rounded-2xl flex items-center justify-between text-xs gap-4 shadow-sm"
          >
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-gray-800">Période :</span>
              <span className="font-mono text-gray-600 bg-gray-50 px-2 py-0.5 rounded border border-gray-150">{data[hoveredIdx].date}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-blue-650">Lectures :</span>
                <span className="font-black font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs flex items-baseline gap-1">
                  <span>{data[hoveredIdx].reads.toLocaleString()}</span>
                  <span className="text-[10px] text-blue-500 font-normal">({formatSize(data[hoveredIdx].readBytes || 0)})</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-amber-655">Écritures :</span>
                <span className="font-black font-mono text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-xs flex items-baseline gap-1">
                  <span>{data[hoveredIdx].writes.toLocaleString()}</span>
                  <span className="text-[10px] text-amber-500 font-normal">({formatSize(data[hoveredIdx].writeBytes || 0)})</span>
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

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
  lastLogin?: any;
  status?: 'active' | 'suspended' | 'expired';
  totalLogins?: number;
  allowedFilieres?: string[];
  allowedLicences?: string[];
  statsScope?: 'promo_only' | 'all_partner_licences';
  hasAdminAccess?: boolean;
  permissions?: string[];
}

interface ConnectionLog {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  timestamp: any;
  filiere: string;
  niveau: string;
}

interface AdminLog {
  id: string;
  targetUserId: string;
  targetUsername: string;
  action: string;
  description: string;
  timestamp: any;
  adminId: string;
  adminName: string;
}

interface UserProgress {
  answeredQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  accuracy: number;
  currentStreak: number;
  lastActiveDate: any;
  fichesViewed?: number;
  videosViewed?: number;
  byBook: { [bookId: string]: { answered: number; correct: number } };
  byChapter: { [chapterId: string]: { answered: number; correct: number } };
}

interface UserConsumption {
  readsToday: number;
  writesToday: number;
  readsMonth: number;
  writesMonth: number;
  lastActiveToday?: string;
  lastActiveMonth?: string;
}

interface PartnerPromoCodesManagerProps {
  selectedUser: UserProfile;
  users: UserProfile[];
  financialHistory: any[];
  globalCurrency: string;
  saveAdminLog: (userId: string, username: string, action: string, description: string) => Promise<any>;
}

export function PartnerPromoCodesManager({
  selectedUser,
  users,
  financialHistory,
  globalCurrency,
  saveAdminLog
}: PartnerPromoCodesManagerProps) {
  const [promoCodes, setPromoCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState('');
  const [statusMsg, setStatusMsg] = useState<{type: 'success'|'error', text: string} | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'promoCodes'), where('partnerId', '==', selectedUser.id));
    const unsub = onSnapshot(q, (snap) => {
      setPromoCodes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'promoCodes');
      setLoading(false);
    });
    return () => unsub();
  }, [selectedUser.id]);

  const handleCreateCode = async (codeText: string) => {
    const clean = codeText.toUpperCase().trim().replace(/\s+/g, '');
    if (!clean) return;
    try {
      // Check globally unique
      const codeSnap = await getDoc(doc(db, 'promoCodes', clean));
      if (codeSnap.exists()) {
        setStatusMsg({ type: 'error', text: `Le code promo ${clean} existe déjà.` });
        return;
      }
      // Also check partner user main codes
      const mainCodeQuery = query(collection(db, 'users'), where('promoCode', '==', clean.toLowerCase()));
      const mainSnap = await getDocs(mainCodeQuery);
      if (!mainSnap.empty) {
        setStatusMsg({ type: 'error', text: `Ce code est déjà utilisé en tant que code parrainage principal par un partenaire.` });
        return;
      }

      await setDoc(doc(db, 'promoCodes', clean), {
        code: clean,
        partnerId: selectedUser.id,
        createdAt: new Date(),
        status: 'active'
      });

      await saveAdminLog(selectedUser.id, selectedUser.username, 'create_promo_code', `Création d'un code promo secondaire [${clean}] pour le partenaire`);
      setNewCode('');
      setStatusMsg({ type: 'success', text: `Code promo ${clean} créé avec succès.` });
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: 'error', text: "Erreur lors de la création du code." });
    }
  };

  const handleAutoGenerate = () => {
    const prefix = (selectedUser.username || '').substring(0, 3).toUpperCase().replace(/\d+/g, '');
    const random = Math.floor(10 + Math.random() * 90);
    const code = `${prefix}${random}`;
    setNewCode(code);
    handleCreateCode(code);
  };

  const toggleStatus = async (item: any) => {
    const nextSt = item.status === 'active' ? 'inactive' : 'active';
    try {
      await updateDoc(doc(db, 'promoCodes', item.code), { status: nextSt });
      await saveAdminLog(selectedUser.id, selectedUser.username, 'toggle_promo_status', `Mise à jour du statut du code promo [${item.code}] à [${nextSt}]`);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <h4 className="text-base font-extrabold text-indigo-950 border-b border-gray-50 pb-2 flex items-center justify-between">
        <span>Codes Promotionnels Secondaires</span>
        <span className="text-xs font-semibold text-gray-400 font-mono">Total : {promoCodes.length} codes</span>
      </h4>

      {/* Quick code creation form */}
      <div className="bg-gray-50 border border-gray-200/60 p-5 rounded-2xl space-y-3.5">
        <div>
          <h5 className="text-xs font-black text-gray-800">Générer un nouveau code promo</h5>
          <p className="text-[10px] text-gray-400 font-semibold mt-0.5">Ajoutez un code promo manuel ou générez-en un de manière automatique rattaché à ce partenaire.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 max-w-md">
          <input
            type="text"
            placeholder="EX: SMK02, IDE2026"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            className="px-3.5 py-2 text-xs font-bold uppercase tracking-widest bg-white border border-gray-250 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 flex-1 font-mono"
          />
          <button
            type="button"
            onClick={() => handleCreateCode(newCode)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl shadow-sm transition active:scale-95"
          >
            Créer le code
          </button>
          <button
            type="button"
            onClick={handleAutoGenerate}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-750 text-white text-xs font-extrabold rounded-xl shadow-sm transition active:scale-95 whitespace-nowrap"
          >
            Générer SMKxx
          </button>
        </div>

        {statusMsg && (
          <p className={cn(
            "text-xs font-bold p-2.5 rounded-lg border max-w-md animate-in slide-in-from-top-1",
            statusMsg.type === 'success' ? "bg-green-50 text-green-700 border-green-150" : "bg-red-50 text-red-700 border-red-150"
          )}>
            {statusMsg.text}
          </p>
        )}
      </div>

      {/* Codes List */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-6">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          <span>Chargement des codes parrainages...</span>
        </div>
      ) : promoCodes.length === 0 ? (
        <div className="text-center py-10 bg-white border border-gray-150 rounded-2xl text-gray-400 font-medium italic text-xs">
          Aucun code promo secondaire rattaché à ce partenaire.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-150 rounded-2xl font-bold">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-150 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                <th className="px-4 py-2.5 font-black">Code Promo</th>
                <th className="px-4 py-2.5 font-black">Date de création</th>
                <th className="px-4 py-2.5 font-black">Statut</th>
                <th className="px-4 py-2.5 font-black text-center">Inscrits</th>
                <th className="px-4 py-2.5 font-black text-right">Revenus</th>
                <th className="px-4 py-2.5 font-black text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-gray-100 text-gray-700">
              {promoCodes.map(item => {
                const codeUpper = item.code.trim().toUpperCase();
                const codeUsers = users.filter(u => u.promoCode?.trim().toUpperCase() === codeUpper);
                const codeTrans = financialHistory.filter(t => t.promoCodeUsed?.trim().toUpperCase() === codeUpper || t.promoCode?.trim().toUpperCase() === codeUpper);
                const uses = codeUsers.length;
                const revenue = codeTrans.reduce((sum, t) => sum + (t.amountPaid || 0), 0);
                const createdAtStr = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString('fr-FR') : (item.createdAt ? new Date(item.createdAt).toLocaleDateString('fr-FR') : 'N/A');

                return (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition duration-200">
                    <td className="px-4 py-3 font-mono text-indigo-900 uppercase tracking-widest text-sm font-extrabold">{item.code}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-[10.5px]">{createdAtStr}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-block px-2 py-0.5 rounded text-[10px] uppercase font-black",
                        item.status === 'active' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      )}>
                        {item.status === 'active' ? 'actif' : 'inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-indigo-950 font-black">{uses}</td>
                    <td className="px-4 py-3 text-right text-emerald-700 font-black font-mono">
                      {typeof formatCurrency === 'function' ? formatCurrency(revenue, globalCurrency) : `${revenue} ${globalCurrency}`}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggleStatus(item)}
                        className="px-2.5 py-1 text-[10px] font-black uppercase text-gray-600 border border-gray-250 hover:bg-gray-50 rounded-lg transition"
                      >
                        {item.status === 'active' ? 'Désactiver' : 'Activer'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ApporteurAutorisationTabProps {
  selectedUser: UserProfile;
  activeFilieres: Array<{ id: string; name: string }>;
  setSelectedUser: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  saveAdminLog: (userId: string, username: string, action: string, description: string) => Promise<any>;
}

export function ApporteurAutorisationTab({
  selectedUser,
  activeFilieres,
  setSelectedUser,
  saveAdminLog
}: ApporteurAutorisationTabProps) {
  const [promoCode, setPromoCode] = useState(selectedUser.promoCode || '');
  const [allowedFilieres, setAllowedFilieres] = useState<string[]>(selectedUser.allowedFilieres || []);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync state if selectedUser changes
  useEffect(() => {
    setPromoCode(selectedUser.promoCode || '');
    setAllowedFilieres(selectedUser.allowedFilieres || []);
    setStatusMsg(null);
  }, [selectedUser]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMsg(null);

    const cleanPromo = promoCode.trim().toLowerCase();

    try {
      // If promo code changed, let's verify it is unique across partners and other users
      if (cleanPromo && cleanPromo !== (selectedUser.promoCode || '').toLowerCase().trim()) {
        const usersSnap = await getDocs(collection(db, 'users'));
        const isConflict = usersSnap.docs.some(doc => {
          if (doc.id === selectedUser.id) return false;
          const data = doc.data();
          return data.promoCode && data.promoCode.trim().toLowerCase() === cleanPromo;
        });

        if (isConflict) {
          setStatusMsg({
            type: 'error',
            text: `Le code promo "${promoCode.toUpperCase()}" est déjà attribué à un autre utilisateur.`
          });
          setIsSaving(false);
          return;
        }
      }

      const userRef = doc(db, 'users', selectedUser.id);
      const updates = {
        promoCode: cleanPromo,
        allowedFilieres: allowedFilieres,
        allowedLicences: allowedFilieres // Keep in sync for safety
      };

      await updateDoc(userRef, updates);

      // Save log
      await saveAdminLog(
        selectedUser.id,
        selectedUser.username,
        'update_apporteur_autho',
        `Modification des autorisations de l'apporteur. Code promo: [${cleanPromo.toUpperCase()}], Filières: [${allowedFilieres.join(', ')}]`
      );

      // Update parent state
      setSelectedUser(prev => prev ? {
        ...prev,
        promoCode: cleanPromo,
        allowedFilieres: allowedFilieres,
        allowedLicences: allowedFilieres
      } : null);

      setStatusMsg({
        type: 'success',
        text: 'Les autorisations et le code promo ont été enregistrés avec succès.'
      });
    } catch (err: any) {
      console.error(err);
      setStatusMsg({
        type: 'error',
        text: err?.message || 'Erreur lors de la sauvegarde.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFiliere = (filiereId: string) => {
    setAllowedFilieres(prev =>
      prev.includes(filiereId)
        ? prev.filter(id => id !== filiereId)
        : [...prev, filiereId]
    );
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-150 pb-4">
        <h4 className="text-base font-extrabold text-indigo-950 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-indigo-600 animate-pulse" />
          Autorisations & Code Promotionnel
        </h4>
        <p className="text-xs text-gray-500 font-medium mt-1">
          Attribuez un code promo et sélectionnez les filières auxquelles l'apporteur d'affaires a accès pour la visite.
        </p>
      </div>

      {statusMsg && (
        <div className={cn(
          "p-4 rounded-xl text-xs font-bold border animate-in fade-in",
          statusMsg.type === 'success' 
            ? "bg-green-50 text-green-700 border-green-150" 
            : "bg-red-50 text-red-700 border-red-150"
        )}>
          {statusMsg.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        {/* Code Promo Section */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-700 block">Code Promo de l'Apporteur d'Affaires</label>
          <p className="text-[11px] text-gray-400 font-semibold">
            Ce code sert de lien de parrainage pour affilier ses étudiants et calculer ses gains.
          </p>
          <input
            type="text"
            required
            placeholder="Ex: APPORTEUR75"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toLowerCase().replace(/\s+/g, ''))}
            className="w-full max-w-sm px-4 py-2 text-sm font-bold tracking-wider uppercase bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Filières Section */}
        <div className="space-y-3">
          <label className="text-xs font-black text-gray-700 block">Filières Autorisées pour Visite / Accès</label>
          <p className="text-[11px] text-gray-400 font-semibold mb-2">
            Cochez les filières d'examens auxquelles cet apporteur peut accéder via son bouton de bascule.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {activeFilieres.map(f => {
              const checked = allowedFilieres.includes(f.id);
              return (
                <label 
                  key={f.id} 
                  className={cn(
                    "flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer text-xs font-bold transition-all hover:bg-gray-50/50",
                    checked 
                      ? "bg-indigo-50/30 border-indigo-200 text-indigo-950" 
                      : "bg-white border-gray-150 text-gray-650"
                  )}
                >
                  <input
                    type="checkbox"
                    className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-300 w-4 h-4"
                    checked={checked}
                    onChange={() => toggleFiliere(f.id)}
                  />
                  <span>{f.name}</span>
                </label>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-sm active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Enregistrer les Autorisations
        </button>
      </form>
    </div>
  );
}

interface PartnerFinancesTabProps {
  selectedUser: UserProfile;
  users: UserProfile[];
  financialHistory: any[];
  globalCurrency: string;
}

export function PartnerFinancesTab({
  selectedUser,
  users,
  financialHistory,
  globalCurrency
}: PartnerFinancesTabProps) {
  const [licenseParamsList, setLicenseParamsList] = useState<LicenseParams[]>([]);

  useEffect(() => {
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
    return () => unsubParams();
  }, []);

  const cleanPromoString = (s: string) => {
    return (s || '')
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };

  const partnerCode = (selectedUser.promoCode || '').toUpperCase().trim();
  const cleanPartnerPromo = cleanPromoString(partnerCode);

  const [secCodes, setSecCodes] = useState<string[]>([]);
  useEffect(() => {
    const qPromo = query(collection(db, 'promoCodes'), where('partnerId', '==', selectedUser.id));
    const unsub = onSnapshot(qPromo, (snap) => {
      setSecCodes(snap.docs.map(doc => doc.id.toUpperCase()));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'promoCodes');
    });
    return () => unsub();
  }, [selectedUser.id]);

  const [partnerExpenses, setPartnerExpenses] = useState<any[]>([]);
  useEffect(() => {
    const qExp = query(collection(db, 'expenses'), where('partnerId', '==', selectedUser.id));
    const unsubExp = onSnapshot(qExp, (snap) => {
      setPartnerExpenses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'expenses');
    });
    return () => unsubExp();
  }, [selectedUser.id]);

  const cleanSecCodes = secCodes.map(code => cleanPromoString(code));
  const allMyPromoCodesClean = [cleanPartnerPromo, ...cleanSecCodes];

  // Filter students linked to this partner with strict parameter enforcement
  const rattachés = users.filter(u => {
    if (u.role !== 'student') return false;

    const belongsByPromo = !!(cleanPartnerPromo && u.promoCode && cleanPromoString(u.promoCode) === cleanPartnerPromo) ||
                           (u.promoCode && cleanSecCodes.includes(cleanPromoString(u.promoCode)));

    // Filter by allowedFilieres comparison
    const allowedFils = selectedUser.allowedFilieres || [];
    const matchesFiliere = allowedFils.length > 0 && u.filiere && allowedFils.some((fId: string) => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const fIdLow = fId.toLowerCase().trim();
      return uFil.includes(fIdLow) || fIdLow.includes(uFil);
    });

    // Filter by allowedLicences comparison
    const allowedLics = selectedUser.allowedLicences || [];
    const matchesLicence = allowedLics.length > 0 && u.filiere && allowedLics.some((lId: string) => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const lIdLow = lId.toLowerCase().trim();
      return uFil.includes(lIdLow) || lIdLow.includes(uFil);
    });

    return belongsByPromo || !!matchesFiliere || !!matchesLicence;
  });

  const getStudentFinanceDetails = (u: any) => {
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

    const isPromoUser = !!(cleanPartnerPromo && u.promoCode && cleanPromoString(u.promoCode) === cleanPartnerPromo) ||
                        (u.promoCode && cleanSecCodes.includes(cleanPromoString(u.promoCode)));
    
    // Check if partner is partner of license
    const allowedFils = selectedUser.allowedFilieres || [];
    const matchesFiliere = allowedFils.length > 0 && u.filiere && allowedFils.some((fId: string) => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const fIdLow = fId.toLowerCase().trim();
      return uFil.includes(fIdLow) || fIdLow.includes(uFil);
    });

    const allowedLics = selectedUser.allowedLicences || [];
    const matchesLicence = allowedLics.length > 0 && u.filiere && allowedLics.some((lId: string) => {
      const uFil = u.filiere?.toLowerCase().trim() || '';
      const lIdLow = lId.toLowerCase().trim();
      return uFil.includes(lIdLow) || lIdLow.includes(uFil);
    });

    const isPartnerOfLicence = !!(matchesFiliere || matchesLicence || u.partnerId === selectedUser.id || u.partnerId === selectedUser.username);

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

  // Build resolved transactions by mapping each rattaché to a real or calculated transaction
  const resolvedTrans = rattachés.map(st => {
    // Try to find an existing real transaction in Firestore
    const foundReal = financialHistory.find(t => {
      const isUserMatch = (t.userId && (t.userId === st.id || t.userId === st.username)) || 
                          (t.username && (t.username === st.id || t.username === st.username));
      return isUserMatch;
    });

    // Determine partner and promo flags
    const allowedFils = selectedUser.allowedFilieres || [];
    const matchesFiliere = allowedFils.length > 0 && st.filiere && allowedFils.some((fId: string) => {
      const uFil = st.filiere?.toLowerCase().trim() || '';
      const fIdLow = fId.toLowerCase().trim();
      return uFil.includes(fIdLow) || fIdLow.includes(uFil);
    });

    const allowedLics = selectedUser.allowedLicences || [];
    const matchesLicence = allowedLics.length > 0 && st.filiere && allowedLics.some((lId: string) => {
      const uFil = st.filiere?.toLowerCase().trim() || '';
      const lIdLow = lId.toLowerCase().trim();
      return uFil.includes(lIdLow) || lIdLow.includes(uFil);
    });

    const isPartnerOfLicence = !!(matchesFiliere || matchesLicence || st.partnerId === selectedUser.id || st.partnerId === selectedUser.username);
    const isPromoUser = !!(cleanPartnerPromo && st.promoCode && cleanPromoString(st.promoCode) === cleanPartnerPromo) ||
                        (st.promoCode && cleanSecCodes.includes(cleanPromoString(st.promoCode)));

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
      partnerId: st.partnerId || selectedUser.id,
      status: 'paid' as const
    };
  });

  // Keep any real transactions that don't match our rattachés list directly
  const unmappedRealTrans = financialHistory.filter(t => {
    const codeMatch = (cleanPartnerPromo && t.promoCode && cleanPromoString(t.promoCode) === cleanPartnerPromo) ||
                      (t.promoCode && cleanSecCodes.includes(cleanPromoString(t.promoCode)));
    const partnerIdMatch = t.partnerId === selectedUser.id || t.partnerId === selectedUser.username;
    const matchesRattache = rattachés.some(st => st.id === t.userId || st.username === t.userId);
    
    const isAlreadyResolved = resolvedTrans.some(rt => rt.id === t.id);
    return (codeMatch || partnerIdMatch || matchesRattache) && !isAlreadyResolved;
  });

  const mappedUnmappedRealTrans = unmappedRealTrans.map(t => {
    const isPromoUser = !!((cleanPartnerPromo && t.promoCode && cleanPromoString(t.promoCode) === cleanPartnerPromo) ||
                        (t.promoCode && cleanSecCodes.includes(cleanPromoString(t.promoCode))));
    
    // Attempt to match the student detail in "users" list
    const matchedStudent = users.find(u => u.id === t.userId || u.username === t.userId);
    let isPartnerOfLicence = false;
    if (matchedStudent) {
      const allowedFils = selectedUser.allowedFilieres || [];
      const matchesFiliere = allowedFils.length > 0 && matchedStudent.filiere && allowedFils.some((fId: string) => {
        const uFil = matchedStudent.filiere?.toLowerCase().trim() || '';
        const fIdLow = fId.toLowerCase().trim();
        return uFil.includes(fIdLow) || fIdLow.includes(uFil);
      });

      const allowedLics = selectedUser.allowedLicences || [];
      const matchesLicence = allowedLics.length > 0 && matchedStudent.filiere && allowedLics.some((lId: string) => {
        const uFil = matchedStudent.filiere?.toLowerCase().trim() || '';
        const lIdLow = lId.toLowerCase().trim();
        return uFil.includes(lIdLow) || lIdLow.includes(uFil);
      });
      isPartnerOfLicence = !!(matchesFiliere || matchesLicence || matchedStudent.partnerId === selectedUser.id || matchedStudent.partnerId === selectedUser.username);
    } else {
      isPartnerOfLicence = t.partnerId === selectedUser.id || t.partnerId === selectedUser.username;
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
  const totalPartnerPayouts = partnerExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const remainingPartnerBalance = Math.max(0, grandTotalComs - totalPartnerPayouts);

  const getCleanCodeDisplay = (code: string) => {
    if (!code) return '';
    return code.trim().toUpperCase();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <h4 className="text-base font-extrabold text-indigo-950 border-b border-gray-50 pb-2">
        Aperçu Financier de {selectedUser.displayName}
      </h4>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white border border-gray-150 p-4 rounded-2xl shadow-sm flex flex-col justify-between hover:shadow-md transition">
          <div>
            <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider block">Licences vendues</span>
            <span className="text-2xl font-black text-gray-900 block mt-1.5">{totalPaidTrans.length}</span>
          </div>
          <span className="text-[10px] text-gray-500 font-semibold block mt-3">Revenus: {formatCurrency(totalRevenueGenerated, globalCurrency)}</span>
        </div>

        <div className="bg-white border border-gray-150 p-4 rounded-2xl shadow-sm flex flex-col justify-between hover:shadow-md transition">
          <div>
            <span className="text-[9px] text-indigo-500 font-bold uppercase tracking-wider block">Commissions Partenaire</span>
            <span className="text-xl font-black text-indigo-600 block mt-1.5">{formatCurrency(totalPartnerComsEarned, globalCurrency)}</span>
          </div>
          <span className="text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md font-bold mt-3 inline-block self-start">Accès direct</span>
        </div>

        <div className="bg-white border border-gray-150 p-4 rounded-2xl shadow-sm flex flex-col justify-between hover:shadow-md transition">
          <div>
            <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-wider block">Comms Code Promo</span>
            <span className="text-xl font-black text-emerald-600 block mt-1.5">{formatCurrency(totalPromoComsEarned, globalCurrency)}</span>
          </div>
          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-bold mt-3 inline-block self-start">Code {selectedUser.promoCode || 'Promo'}</span>
        </div>

        <div className="bg-slate-50 border border-gray-200 p-4 rounded-2xl shadow-sm flex flex-col justify-between hover:shadow-md transition">
          <div>
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">Gains Cumulés (Brut)</span>
            <span className="text-xl font-black text-slate-800 block mt-1.5">{formatCurrency(grandTotalComs, globalCurrency)}</span>
          </div>
          <span className="text-[10px] text-slate-500 font-semibold block mt-3">Total accumulé</span>
        </div>

        <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl shadow-sm flex flex-col justify-between hover:shadow-md transition">
          <div>
            <span className="text-[9px] text-rose-500 font-bold uppercase tracking-wider block">Déjà Payé (Sorties)</span>
            <span className="text-xl font-black text-rose-600 block mt-1.5">{formatCurrency(totalPartnerPayouts, globalCurrency)}</span>
          </div>
          <span className="text-[10px] text-rose-800 bg-rose-100/40 px-2 py-0.5 rounded-md font-bold mt-3 inline-block self-start">Règlements reçus</span>
        </div>

        <div className="bg-emerald-950 text-white p-4 rounded-2xl shadow-sm flex flex-col justify-between hover:shadow-md transition border border-emerald-900">
          <div>
            <span className="text-[9px] text-emerald-300 font-bold uppercase tracking-wider block">Solde Restant Dû</span>
            <span className="text-2xl font-black text-emerald-400 block mt-1.5">{formatCurrency(remainingPartnerBalance, globalCurrency)}</span>
          </div>
          <span className="text-[10px] text-emerald-100 bg-emerald-800/40 px-2 py-0.5 rounded-md font-bold mt-3 inline-block self-start">Reste à reverser</span>
        </div>
      </div>

      {/* Historical records grid with two sections: Sales vs Payouts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pt-2">
        <div className="space-y-3">
          <h5 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
            Ventes Parrainées ({partnerTrans.length})
          </h5>
          {partnerTrans.length === 0 ? (
            <p className="text-xs text-gray-400 font-medium italic text-center py-10 bg-white border border-gray-150 rounded-2xl">Aucune transaction facturée pour le moment.</p>
          ) : (
            <div className="overflow-x-auto border border-gray-150 rounded-2xl font-bold bg-white shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-150 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Abonné</th>
                    <th className="px-4 py-2.5">Licence</th>
                    <th className="px-4 py-2.5 text-right">Payé</th>
                    <th className="px-4 py-2.5 text-right text-indigo-600 font-mono">Com. Part</th>
                    <th className="px-4 py-2.5 text-right text-emerald-700 font-mono">Com. Promo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {partnerTrans.map(t => {
                    const tDate = t.date?.toDate ? t.date.toDate().toLocaleDateString('fr-FR') : (t.date ? new Date(t.date).toLocaleDateString('fr-FR') : 'N/A');

                    return (
                      <tr key={t.id} className="hover:bg-gray-50/50 transition duration-200">
                        <td className="px-4 py-2.5 font-mono text-[10px] text-gray-400 whitespace-nowrap">{tDate}</td>
                        <td className="px-4 py-2.5 text-gray-900 font-bold">@{t.username}</td>
                        <td className="px-4 py-2.5">
                          <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[9px] font-black uppercase">
                            {t.licenseId}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold">
                          {formatCurrency(t.amountPaid || 0, globalCurrency)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-indigo-600 font-mono">
                          {formatCurrency(Number(t.commissionPartner || 0), globalCurrency)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-emerald-700 font-mono">
                          {formatCurrency(Number(t.commissionPromo || t.promoCommission || 0), globalCurrency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* List of payouts / payouts registered as expenses */}
        <div className="space-y-3">
          <h5 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-rose-500" />
            Règlements & Retraits reversés ({partnerExpenses.length})
          </h5>
          {partnerExpenses.length === 0 ? (
            <p className="text-xs text-slate-400 font-medium italic text-center py-10 bg-white border border-gray-150 rounded-2xl">Aucun règlement n'a encore été reversé à ce partenaire.</p>
          ) : (
            <div className="overflow-x-auto border border-gray-150 rounded-2xl font-bold bg-white shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Détail du règlement</th>
                    <th className="px-4 py-2.5 text-center">Auteur</th>
                    <th className="px-4 py-2.5 text-right font-mono">Montant versé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-slate-700">
                  {partnerExpenses.map(exp => {
                    const eDate = exp.date?.toDate ? exp.date.toDate().toLocaleDateString('fr-FR') : (exp.date ? new Date(exp.date).toLocaleDateString('fr-FR') : 'N/A');

                    return (
                      <tr key={exp.id} className="hover:bg-rose-50/10 transition duration-200">
                        <td className="px-4 py-2.5 font-mono text-[10px] text-gray-400 whitespace-nowrap">{eDate}</td>
                        <td className="px-4 py-2.5 text-slate-900">
                          <span className="block font-black text-rose-700 text-[9px] uppercase tracking-wider mb-0.5">
                            {exp.motif === 'payement partenaire' ? 'Règlement Direct' : 'Com. Coupon'}
                          </span>
                          <span className="text-[10px] font-medium text-slate-500 line-clamp-1" title={exp.description}>{exp.description}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-slate-600 font-bold whitespace-nowrap">
                          {exp.authorizedBy || 'Admin'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-black text-rose-600 whitespace-nowrap">
                          - {formatCurrency(exp.amount || 0, globalCurrency)}
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
    </div>
  );
}

export default function UserManagementView() {
  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [connections, setConnections] = useState<ConnectionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [userConsumptions, setUserConsumptions] = useState<{ [userId: string]: UserConsumption }>({});
  const [dailyConsumptions, setDailyConsumptions] = useState<any[]>([]);
  
  const [globalCurrency, setGlobalCurrency] = useState('XOF');
  const [financialHistory, setFinancialHistory] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'financialSettings'), (snap) => {
      if (snap.exists() && snap.data().currency) {
        setGlobalCurrency(snap.data().currency);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'settings/financialSettings');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'financialHistory'), (snap) => {
      setFinancialHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'financialHistory');
    });
    return () => unsub();
  }, []);
  
  const [dbFilieres, setDbFilieres] = useState<{ id: string; name: string; levels: string[] }[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'filieres'), (snap) => {
      const list: any[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.status === 'active' || !data.status) {
          list.push({ id: docSnap.id, name: data.name || docSnap.id, levels: data.levels || ['ALL'] });
        }
      });
      if (list.length > 0) {
        setDbFilieres(list);
      }
    }, (err) => {
      console.warn("Could not fetch filieres from db", err);
    });
    return () => unsub();
  }, []);

  const activeFilieres = dbFilieres.length > 0 ? dbFilieres : FILIERES;
  const filiereOptions = activeFilieres.map(f => ({ id: f.id, name: f.name }));
  const getDynamicLevelsForFiliere = (filiereId: string) => {
    const f = activeFilieres.find(x => x.id === filiereId);
    return f ? f.levels : ['ALL'];
  };
  
  // Filtering & Sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [filiereFilter, setFiliereFilter] = useState('all');
  const [niveauFilter, setNiveauFilter] = useState('all');
  const [licenseFilter, setLicenseFilter] = useState('all'); // all, active, expired, suspended

  // DB Monitoring Search & Filters
  const [dbSearch, setDbSearch] = useState('');
  const [dbRoleFilter, setDbRoleFilter] = useState<'all' | 'student' | 'partner' | 'apporteur' | 'admin'>('all');
  const [dbPeriodFilter, setDbPeriodFilter] = useState<'all' | 'today' | 'month'>('all');
  const [dbSortBy, setDbSortBy] = useState<'reads' | 'writes'>('reads');
  const [statsSubTab, setStatsSubTab] = useState<'traffic' | 'financial'>('traffic');

  // Interactive Simulation States
  const [useRealMetrics, setUseRealMetrics] = useState<boolean>(true);
  const [simulatedSubscribers, setSimulatedSubscribers] = useState<number>(50);
  const [avgDailyReadsPerUser, setAvgDailyReadsPerUser] = useState<number>(120);
  const [avgDailyWritesPerUser, setAvgDailyWritesPerUser] = useState<number>(30);
  const [avgDailyTransferPerUserKB, setAvgDailyTransferPerUserKB] = useState<number>(650);
  const [simulatedDbStorageGB, setSimulatedDbStorageGB] = useState<number>(3.5);
  const [hostingStorageGB, setHostingStorageGB] = useState<number>(8.0);

  // Modal creation states
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    role: 'student' as 'admin' | 'student' | 'partner' | 'apporteur',
    displayName: '',
    phone: '',
    email: '',
    promoCode: '',
    duration: 'unlimited',
    filiere: 'ECN',
    niveau: 'ALL',
    allowedFilieres: [] as string[],
    allowedLicences: [] as string[],
    statsScope: 'all_partner_licences' as 'promo_only' | 'all_partner_licences',
    hasAdminAccess: false,
    permissions: [] as string[]
  });
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; username: string; displayName: string } | null>(null);
  const [userToResetDevice, setUserToResetDevice] = useState<{ id: string; username: string; displayName: string } | null>(null);

  // Single subscriber detail sheet
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'licence' | 'activite' | 'pedago' | 'conso' | 'logs' | 'promo_codes' | 'finances_partner' | 'autorisation'>('info');
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [selectedUserProgress, setSelectedUserProgress] = useState<UserProgress | null>(null);
  const [selectedUserConsumption, setSelectedUserConsumption] = useState<UserConsumption | null>(null);
  const [selectedUserLogs, setSelectedUserLogs] = useState<AdminLog[]>([]);
  
  // Details inline editing
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isEditingLicenseDirectly, setIsEditingLicenseDirectly] = useState(false);
  const [directLicenseType, setDirectLicenseType] = useState<'unlimited' | 'limited'>('unlimited');
  const [directLicenseExpiryDate, setDirectLicenseExpiryDate] = useState('');
  const [editForm, setEditForm] = useState({
    role: 'student' as 'admin' | 'student' | 'partner' | 'apporteur',
    displayName: '',
    phone: '',
    filiere: 'ECN',
    niveau: 'ALL',
    email: '',
    promoCode: '',
    partnerId: '',
    allowedFilieres: [] as string[],
    allowedLicences: [] as string[],
    statsScope: 'all_partner_licences' as 'promo_only' | 'all_partner_licences',
    hasAdminAccess: false,
    permissions: [] as string[],
    licenseType: 'unlimited' as 'unlimited' | 'limited',
    licenseExpiryDate: ''
  });

  // Books / Chapters caching for name mapping
  const [books, setBooks] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);

  // DB Subscriptions
  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'users');
      setLoading(false);
    });

    const unsubStats = onSnapshot(doc(db, 'stats', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        setGlobalStats(docSnap.data());
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'stats/global');
    });

    const connQuery = query(collection(db, 'connections'), orderBy('timestamp', 'desc'), limit(100));
    const unsubConn = onSnapshot(connQuery, (snap) => {
      setConnections(snap.docs.map(d => ({ id: d.id, ...d.data() } as ConnectionLog)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'connections');
    });

    // Load reference books & chapters
    const unsubBooks = onSnapshot(query(collection(db, 'books')), (snap) => {
      setBooks(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'books');
    });
    const unsubChapters = onSnapshot(query(collection(db, 'chapters')), (snap) => {
      setChapters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'chapters');
    });

    // Realtime subscriptions for reads/writes collections
    const unsubConso = onSnapshot(collection(db, 'userConsumption'), (snap) => {
      const consoMap: { [userId: string]: UserConsumption } = {};
      snap.docs.forEach(doc => {
        consoMap[doc.id] = doc.data() as UserConsumption;
      });
      setUserConsumptions(consoMap);
    }, (err) => {
      console.warn("Could not fetch global userConsumption:", err);
    });

    const unsubDaily = onSnapshot(query(collection(db, 'dailyDbConsumption'), orderBy('date', 'asc')), (snap) => {
      setDailyConsumptions(snap.docs.map(d => d.data()));
    }, (err) => {
      console.warn("Could not fetch global dailyDbConsumption:", err);
    });

    return () => {
      unsubscribe();
      unsubStats();
      unsubConn();
      unsubBooks();
      unsubChapters();
      unsubConso();
      unsubDaily();
    };
  }, []);

  // Sync selectedUser if the main list is updated
  useEffect(() => {
    if (selectedUser) {
      const refreshed = users.find(u => u.id === selectedUser.id);
      if (refreshed) {
        setSelectedUser(refreshed);
      }
    }
  }, [users]);

  // Sync simulatedSubscribers with users list length once loaded
  useEffect(() => {
    if (users.length > 0) {
      setSimulatedSubscribers(u => u === 50 ? users.length : u);
    }
  }, [users]);

  // Load detailed subscriber logs / progress / consumption on demand
  const handleSelectUser = async (user: UserProfile) => {
    setSelectedUser(user);
    setDetailTab('info');
    setLoadingDetails(true);
    setIsEditingInfo(false);

    const userExpiry = user.expiresAt;
    let initialType: 'unlimited' | 'limited' = 'unlimited';
    let initialExpiryString = '';
    
    if (userExpiry) {
      initialType = 'limited';
      const expDate = userExpiry.toDate ? userExpiry.toDate() : new Date(userExpiry);
      try {
        initialExpiryString = expDate.toISOString().split('T')[0];
      } catch (err) {
        initialExpiryString = new Date().toISOString().split('T')[0];
      }
    }

    setDirectLicenseType(initialType);
    setDirectLicenseExpiryDate(initialExpiryString);
    setIsEditingLicenseDirectly(false);

    setEditForm({
      role: user.role || 'student',
      displayName: user.displayName || '',
      phone: user.phone || '',
      filiere: user.filiere || 'ECN',
      niveau: user.niveau || 'ALL',
      email: user.email || '',
      promoCode: user.promoCode || '',
      partnerId: user.partnerId || '',
      allowedFilieres: user.allowedFilieres || [],
      allowedLicences: user.allowedLicences || [],
      statsScope: user.statsScope || 'all_partner_licences',
      hasAdminAccess: user.hasAdminAccess || false,
      permissions: user.permissions || [],
      licenseType: initialType,
      licenseExpiryDate: initialExpiryString
    });

    try {
      // 1. Fetch userProgress
      console.log("Fetching userProgress for", user.id);
      try {
        const progressSnap = await getDoc(doc(db, 'userProgress', user.id));
        if (progressSnap.exists()) {
          setSelectedUserProgress(progressSnap.data() as UserProgress);
        } else {
          setSelectedUserProgress(null);
        }
      } catch (err: any) {
        console.error("Error fetching userProgress:", err);
        setSelectedUserProgress(null);
        handleFirestoreError(err, OperationType.GET, `userProgress/${user.id}`);
      }

      // 2. Fetch userConsumption
      console.log("Fetching userConsumption for", user.id);
      try {
        const consoSnap = await getDoc(doc(db, 'userConsumption', user.id));
        if (consoSnap.exists()) {
          setSelectedUserConsumption(consoSnap.data() as UserConsumption);
        } else {
          setSelectedUserConsumption({
            readsToday: 0,
            writesToday: 0,
            readsMonth: 0,
            writesMonth: 0
          });
        }
      } catch (err: any) {
        console.error("Error fetching userConsumption:", err);
        setSelectedUserConsumption({
          readsToday: 0,
          writesToday: 0,
          readsMonth: 0,
          writesMonth: 0
        });
        handleFirestoreError(err, OperationType.GET, `userConsumption/${user.id}`);
      }

      // 3. Fetch audit logs
      console.log("Fetching userLogs for", user.id);
      try {
        await fetchUserLogs(user.id);
      } catch (err: any) {
        console.error("Error fetching userLogs:", err);
        setSelectedUserLogs([]);
        handleFirestoreError(err, OperationType.GET, `userLogs/${user.id}`);
      }

    } catch (err: any) {
      console.error("General error loading subscriber complete details:", err?.message || err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const fetchUserLogs = async (userId: string) => {
    try {
      const logSnap = await getDocs(
        query(
          collection(db, 'userLogs'), 
          where('targetUserId', '==', userId)
        )
      );
      const items = logSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdminLog));
      // Sort client side because compound index may not exist
      items.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp).getTime();
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp).getTime();
        return timeB - timeA;
      });
      setSelectedUserLogs(items);
    } catch (e) {
      console.warn("Could not fetch user administrative logs", e);
    }
  };

  const saveAdminLog = async (userId: string, username: string, action: string, description: string) => {
    try {
      await addDoc(collection(db, 'userLogs'), {
        targetUserId: userId,
        targetUsername: username,
        action,
        description,
        timestamp: new Date(),
        adminId: 'admin',
        adminName: 'Administrateur'
      });
    } catch (e) {
      console.error("Error writing admin log:", e);
    }
  };

  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let pass = "";
    for (let i = 0; i < 8; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username) return;
    
    setIsSubmitting(true);
    setStatus(null);
    
    try {
      const password = generatePassword();
      const cleanUsername = newUser.username.toLowerCase().trim().replace(/\s+/g, '');
      
      if (users.find(u => u.username?.toLowerCase() === cleanUsername)) {
        throw new Error("Cet utilisateur existe déjà.");
      }

      const userRef = doc(db, 'users', cleanUsername);
      
      let expiresAt = null;
      if (newUser.role !== 'partner' && newUser.duration !== 'unlimited') {
        const date = new Date();
        date.setMonth(date.getMonth() + parseInt(newUser.duration));
        expiresAt = date;
      }

      let partnerId = '';
      let promoCodeVal = newUser.role === 'student' ? (newUser.promoCode || '').trim().toLowerCase() : '';
      if (newUser.role === 'student' && promoCodeVal) {
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          const foundPartner = usersSnap.docs.find(d => {
            const uData = d.data();
            return (uData.role === 'partner' || uData.role === 'apporteur') && 
                   uData.promoCode && 
                   uData.promoCode.trim().toLowerCase() === promoCodeVal;
          });
          if (foundPartner) {
            partnerId = foundPartner.id;
          }
        } catch (err) {
          console.warn("Could not auto-link student to partner/apporteur during creation:", err);
        }
      }

      const userData: any = {
        username: cleanUsername,
        password: password,
        role: newUser.role,
        displayName: newUser.displayName || cleanUsername,
        phone: newUser.phone || '',
        createdAt: serverTimestamp(),
        expiresAt: expiresAt,
        status: 'active'
      };

      if (newUser.role === 'partner' || newUser.role === 'apporteur') {
        userData.email = newUser.email || '';
        userData.promoCode = newUser.promoCode || '';
        userData.filiere = 'PARTENAIRE';
        userData.niveau = 'N/A';
        userData.allowedFilieres = newUser.allowedFilieres || [];
        userData.allowedLicences = newUser.allowedLicences || [];
        userData.statsScope = newUser.statsScope || 'all_partner_licences';
        userData.hasAdminAccess = newUser.hasAdminAccess || false;
        userData.permissions = newUser.permissions || [];
      } else {
        userData.filiere = newUser.filiere;
        userData.niveau = newUser.niveau;
        userData.promoCode = promoCodeVal;
        userData.partnerId = partnerId;
      }

      await setDoc(userRef, userData);

      // Record financial trans if subscriber with duration
      if (newUser.role === 'student' && newUser.duration !== 'unlimited') {
        await recordFinancialTransaction({
          userId: cleanUsername,
          username: cleanUsername,
          licenseId: newUser.filiere,
          durationMonths: parseInt(newUser.duration),
          promoCodeUsed: promoCodeVal,
          partnerId: partnerId
        });
      }

      // Write action log
      await saveAdminLog(
        cleanUsername, 
        cleanUsername, 
        'create_account', 
        newUser.role === 'partner' 
          ? `Création du compte partenaire : ${newUser.displayName || cleanUsername} avec code promo [${newUser.promoCode}]`
          : newUser.role === 'apporteur'
            ? `Création du compte apporteur : ${newUser.displayName || cleanUsername} avec code promo [${newUser.promoCode}]`
            : `Création du compte utilisateur avec filière [${newUser.filiere}], niveau [${newUser.niveau}] et validité [${newUser.duration} mois]`
      );

      setGeneratedPassword(password);
      setStatus({ type: 'success', message: newUser.role === 'partner' ? "Compte partenaire créé avec succès." : newUser.role === 'apporteur' ? "Compte apporteur d'affaires créé avec succès." : "Compte abonné créé avec succès." });
      setNewUser({ 
        username: '', 
        role: 'student', 
        displayName: '', 
        phone: '', 
        email: '', 
        promoCode: '', 
        duration: 'unlimited', 
        filiere: 'ECN', 
        niveau: 'ALL',
        allowedFilieres: [],
        allowedLicences: [],
        statsScope: 'all_partner_licences',
        hasAdminAccess: false,
        permissions: []
      });
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || "Erreur lors de l'ajout de l'utilisateur." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = (userId: string, username: string, displayName?: string) => {
    setUserToDelete({ 
      id: userId, 
      username, 
      displayName: displayName || username 
    });
  };

  const executeDeleteUser = async () => {
    if (!userToDelete) return;
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'users', userToDelete.id));
      // Cleanup progress
      await deleteDoc(doc(db, 'userProgress', userToDelete.id)).catch(() => {});
      
      // Save log
      await saveAdminLog(userToDelete.id, userToDelete.username, 'delete_account', `Suppression irrémédiable du compte`);

      setStatus({ type: 'success', message: `Le compte de "${userToDelete.displayName}" a été effacé avec succès.` });
      setSelectedUser(null);
      setUserToDelete(null);
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || "Erreur lors de la suppression." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Inline profile editing save
  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      const userRef = doc(db, 'users', selectedUser.id);
      const newRole = editForm.role || selectedUser.role || 'student';
      
      const updates: any = {
        role: newRole,
        displayName: editForm.displayName,
        phone: editForm.phone,
        filiere: editForm.filiere,
        niveau: editForm.niveau
      };

      let finalExpiresAt: Date | null = null;
      if (editForm.licenseType === 'limited' && editForm.licenseExpiryDate) {
        finalExpiresAt = new Date(editForm.licenseExpiryDate);
      }
      updates.expiresAt = finalExpiresAt;

      if (newRole === 'partner' || newRole === 'apporteur') {
        updates.email = editForm.email || '';
        updates.promoCode = editForm.promoCode || '';
        updates.allowedFilieres = editForm.allowedFilieres || [];
        updates.allowedLicences = editForm.allowedLicences || [];
        updates.statsScope = editForm.statsScope || 'all_partner_licences';
        updates.hasAdminAccess = editForm.hasAdminAccess || false;
        updates.permissions = editForm.permissions || [];
        updates.filiere = 'PARTENAIRE';
        updates.niveau = 'N/A';
      } else if (newRole === 'student') {
        let partnerId = editForm.partnerId || '';
        const promoCodeVal = (editForm.promoCode || '').trim();
        if (promoCodeVal) {
          try {
            const cleanPromoVal = promoCodeVal.toLowerCase();
            const usersSnap = await getDocs(collection(db, 'users'));
            const foundPartner = usersSnap.docs.find(d => {
              const pData = d.data();
              return (pData.role === 'partner' || pData.role === 'apporteur') && 
                     pData.promoCode && 
                     pData.promoCode.trim().toLowerCase() === cleanPromoVal;
            });
            if (foundPartner) {
              partnerId = foundPartner.id;
            }
          } catch (err) {
            console.warn("Could not auto-link student to partner/apporteur during edit save:", err);
          }
        }
        updates.partnerId = partnerId;
        updates.promoCode = promoCodeVal;
      }

      await updateDoc(userRef, updates);

      // Update local selection
      const updated: any = { 
        ...selectedUser, 
        role: newRole,
        displayName: editForm.displayName, 
        phone: editForm.phone,
        filiere: updates.filiere,
        niveau: updates.niveau,
        email: editForm.email,
        promoCode: updates.promoCode || '',
        partnerId: updates.partnerId || '',
        expiresAt: finalExpiresAt
      };

      if (newRole === 'partner' || newRole === 'apporteur') {
        updated.allowedFilieres = editForm.allowedFilieres || [];
        updated.allowedLicences = editForm.allowedLicences || [];
        updated.statsScope = editForm.statsScope || 'all_partner_licences';
        updated.hasAdminAccess = editForm.hasAdminAccess || false;
        updated.permissions = editForm.permissions || [];
      }
      setSelectedUser(updated);

      // Log specific field modifications
      if (selectedUser.role !== newRole) {
        await saveAdminLog(selectedUser.id, selectedUser.username, 'change_role', `Modification du rôle de l'utilisateur : de ${selectedUser.role} à ${newRole}`);
      }
      if (selectedUser.filiere !== editForm.filiere && newRole !== 'partner') {
        await saveAdminLog(selectedUser.id, selectedUser.username, 'change_filiere', `Modification de filière : de ${selectedUser.filiere || 'N/A'} à ${editForm.filiere}`);
      }
      if (selectedUser.niveau !== editForm.niveau && newRole !== 'partner') {
        await saveAdminLog(selectedUser.id, selectedUser.username, 'change_niveau', `Modification de niveau : de ${selectedUser.niveau || 'N/A'} à ${editForm.niveau}`);
      }
      if (selectedUser.partnerId !== editForm.partnerId && newRole === 'student') {
        await saveAdminLog(selectedUser.id, selectedUser.username, 'change_partner', `Modification du partenaire rattaché : de ${selectedUser.partnerId || 'Aucun'} à ${editForm.partnerId || 'Aucun'}`);
      }
      if (selectedUser.phone !== editForm.phone || selectedUser.displayName !== editForm.displayName) {
        await saveAdminLog(selectedUser.id, selectedUser.username, 'update_info', "Mise à jour des coordonnées personnelles d'identité");
      }

      // Check and log license changes
      const oldExpiry = selectedUser.expiresAt 
        ? (selectedUser.expiresAt.toDate ? selectedUser.expiresAt.toDate() : new Date(selectedUser.expiresAt))
        : null;
      const oldExpiryStr = oldExpiry ? oldExpiry.toISOString().split('T')[0] : '';
      const newExpiryStr = finalExpiresAt ? finalExpiresAt.toISOString().split('T')[0] : '';
      
      if (oldExpiryStr !== newExpiryStr) {
        let actionDesc = '';
        if (!finalExpiresAt) {
          actionDesc = `Licence passée en accès illimité (à vie)`;
        } else {
          actionDesc = `Date d'expiration de licence modifiée à : ${finalExpiresAt.toLocaleDateString('fr-FR')}`;
        }
        await saveAdminLog(selectedUser.id, selectedUser.username, 'renew_license', actionDesc);
      }

      setIsEditingInfo(false);
      fetchUserLogs(selectedUser.id);
      setStatus({ type: 'success', message: "Profil mis à jour avec succès." });
    } catch (e) {
      console.error(e);
      setStatus({ type: 'error', message: "Erreur lors de la mise à jour." });
    }
  };

  // Status block change
  const handleStatusChange = async (newStatus: 'active' | 'suspended' | 'expired') => {
    if (!selectedUser) return;
    try {
      const userRef = doc(db, 'users', selectedUser.id);
      await updateDoc(userRef, { status: newStatus });

      const updated = { ...selectedUser, status: newStatus };
      setSelectedUser(updated);

      const actionMap = { active: 'reactivate', suspended: 'suspend', expired: 'change_status' };
      const descMap = {
        active: "Réactivation manuelle de l'accès",
        suspended: "Compte suspendu (le point d'accès affichera connexion refusée)",
        expired: "Marquage manuel de licence expirée (accès bloqué)"
      };

      await saveAdminLog(selectedUser.id, selectedUser.username, actionMap[newStatus], descMap[newStatus]);
      fetchUserLogs(selectedUser.id);
      setStatus({ type: 'success', message: `Modification enregistrée : État positionné sur [${newStatus.toUpperCase()}]` });
    } catch (e) {
      console.error(e);
      setStatus({ type: 'error', message: "Erreur lors de la mise à jour de l'état." });
    }
  };

  // Save directly modified license
  const handleSaveLicenseDirectly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      const userRef = doc(db, 'users', selectedUser.id);
      let finalExpiresAt: Date | null = null;
      if (directLicenseType === 'limited' && directLicenseExpiryDate) {
        finalExpiresAt = new Date(directLicenseExpiryDate);
      }

      await updateDoc(userRef, {
        expiresAt: finalExpiresAt,
        status: 'active'
      });

      const updated = {
        ...selectedUser,
        expiresAt: finalExpiresAt,
        status: 'active' as const
      };
      setSelectedUser(updated);

      // Check and log license changes
      const oldExpiry = selectedUser.expiresAt 
        ? (selectedUser.expiresAt.toDate ? selectedUser.expiresAt.toDate() : new Date(selectedUser.expiresAt))
        : null;
      const oldExpiryStr = oldExpiry ? oldExpiry.toISOString().split('T')[0] : '';
      const newExpiryStr = finalExpiresAt ? finalExpiresAt.toISOString().split('T')[0] : '';
      
      if (oldExpiryStr !== newExpiryStr) {
        let actionDesc = '';
        if (!finalExpiresAt) {
          actionDesc = `Licence passée en accès illimité (à vie) via modification directe`;
        } else {
          actionDesc = `Date d'expiration de licence modifiée à : ${finalExpiresAt.toLocaleDateString('fr-FR')} via modification directe`;
        }
        await saveAdminLog(selectedUser.id, selectedUser.username, 'renew_license', actionDesc);
      }

      setIsEditingLicenseDirectly(false);
      fetchUserLogs(selectedUser.id);
      setStatus({ type: 'success', message: "Licence mise à jour avec succès." });
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de la modification de la licence." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // License extension handler
  const handleExtendLicense = async (months: number) => {
    if (!selectedUser) return;
    try {
      const now = new Date();
      let currentExpiry = selectedUser.expiresAt 
        ? (selectedUser.expiresAt.toDate ? selectedUser.expiresAt.toDate() : new Date(selectedUser.expiresAt)) 
        : null;

      let baseDate = now;
      if (currentExpiry && currentExpiry > now) {
        baseDate = currentExpiry;
      }

      const newExpiry = new Date(baseDate);
      newExpiry.setMonth(newExpiry.getMonth() + months);

       const userRef = doc(db, 'users', selectedUser.id);
      await updateDoc(userRef, {
        expiresAt: newExpiry,
        status: 'active' // Auto reactivate when license extended
      });

      // Record financial transaction for manual renewal
      await recordFinancialTransaction({
        userId: selectedUser.id,
        username: selectedUser.username,
        licenseId: selectedUser.filiere || 'ECN',
        durationMonths: months,
        promoCodeUsed: selectedUser.promoCode || '',
        partnerId: selectedUser.partnerId || ''
      }).catch(err => console.warn("Failed recording financial history of renewal:", err));

      const updated = { ...selectedUser, expiresAt: newExpiry, status: 'active' as const };
      setSelectedUser(updated);

      await saveAdminLog(
        selectedUser.id, 
        selectedUser.username, 
        'renew_license', 
        `Renouvellement de licence : +${months} mois. Nouvelle date d'expiration : ${newExpiry.toLocaleDateString('fr-FR')}`
      );

      fetchUserLogs(selectedUser.id);
      setStatus({ type: 'success', message: `Licence prolongée de ${months} mois. Nouvelle expiration : ${newExpiry.toLocaleDateString('fr-FR')}` });
    } catch (e) {
      console.error(e);
      setStatus({ type: 'error', message: "Erreur de prolongation de la licence." });
    }
  };

  // Device lockout reset
  const handleResetDevice = async () => {
    if (!selectedUser) return;
    setUserToResetDevice({
      id: selectedUser.id,
      username: selectedUser.username,
      displayName: selectedUser.displayName || selectedUser.username
    });
  };

  const executeResetDevice = async () => {
    if (!userToResetDevice) return;
    setIsSubmitting(true);
    try {
      const userRef = doc(db, 'users', userToResetDevice.id);
      await updateDoc(userRef, { 
        hasLoggedIn: false,
        deviceId: "" 
      });

      if (selectedUser && selectedUser.id === userToResetDevice.id) {
        const updated = { ...selectedUser, hasLoggedIn: false, deviceId: "" };
        setSelectedUser(updated);
      }

      await saveAdminLog(
        userToResetDevice.id, 
        userToResetDevice.username, 
        'reset_credentials', 
        "Réinitialisation d'appareil pour transfert de session (Changement de téléphone)"
      );

      fetchUserLogs(userToResetDevice.id);
      setStatus({ type: 'success', message: "Verrous réinitialisés. L'accès mobile est repositionné sur prêt à l'activation." });
      setUserToResetDevice(null);
    } catch (err) {
      console.error(err);
      setStatus({ type: "error", message: "Erreur lors de la réinitialisation des verrous." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Computations for calculations
  const calculateDaysRemaining = (expiryDate: any) => {
    if (!expiryDate) return 'Illimité';
    const date = expiryDate.toDate ? expiryDate.toDate() : new Date(expiryDate);
    const diff = date.getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  };

  const getStatusLabelText = (u: UserProfile) => {
    if (u.status === 'suspended') return 'Suspendu';
    
    const dRemaining = calculateDaysRemaining(u.expiresAt);
    if (dRemaining !== 'Illimité' && typeof dRemaining === 'number' && dRemaining <= 0) return 'Expiré';
    if (u.status === 'expired') return 'Expiré';
    
    return 'Actif';
  };

  // Search, filtration and mapping logic
  const filteredUsers = users.filter(u => {
    // 1. Search term
    const matchesSearch = 
      (u.username?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
      (u.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (u.phone || '').includes(searchTerm);

    // 2. Filière filter
    const matchesFiliere = filiereFilter === 'all' || u.filiere === filiereFilter;

    // 3. Niveau filter
    const matchesNiveau = niveauFilter === 'all' || u.niveau === niveauFilter;

    // 4. Licence filter
    const dRemaining = calculateDaysRemaining(u.expiresAt);
    const resolvedStatus = getStatusLabelText(u);

    let matchesLicense = true;
    if (licenseFilter === 'active') {
      matchesLicense = resolvedStatus === 'Actif';
    } else if (licenseFilter === 'expired') {
      matchesLicense = resolvedStatus === 'Expiré';
    } else if (licenseFilter === 'suspended') {
      matchesLicense = resolvedStatus === 'Suspendu';
    }

    return matchesSearch && matchesFiliere && matchesNiveau && matchesLicense;
  });

  // Dynamic values for dashboard metrics
  const totalSubscribers = users.length;
  const activeSubscribers = users.filter(u => getStatusLabelText(u) === 'Actif').length;
  const suspendedSubscribers = users.filter(u => u.status === 'suspended').length;
  const expiredLicenses = users.filter(u => getStatusLabelText(u) === 'Expiré').length;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const connToday = connections.filter(c => {
    const time = c.timestamp?.toDate ? c.timestamp.toDate() : new Date(c.timestamp);
    return time >= todayStart;
  });
  const loginsTodayCount = connToday.length;
  const activeTodayCount = new Set(connToday.map(c => c.userId)).size;

  const nowTime = new Date();
  const sevenDaysLimit = new Date();
  sevenDaysLimit.setDate(nowTime.getDate() + 7);
  const thirtyDaysLimit = new Date();
  thirtyDaysLimit.setDate(nowTime.getDate() + 30);

  const alerts7Days = users.filter(u => {
    if (u.role === 'admin' || !u.expiresAt) return false;
    const exp = u.expiresAt.toDate ? u.expiresAt.toDate() : new Date(u.expiresAt);
    const dRemaining = calculateDaysRemaining(u.expiresAt);
    return dRemaining !== 'Illimité' && dRemaining > 0 && dRemaining <= 7;
  }).length;

  const alerts30Days = users.filter(u => {
    if (u.role === 'admin' || !u.expiresAt) return false;
    const exp = u.expiresAt.toDate ? u.expiresAt.toDate() : new Date(u.expiresAt);
    const dRemaining = calculateDaysRemaining(u.expiresAt);
    return dRemaining !== 'Illimité' && dRemaining > 0 && dRemaining <= 30;
  }).length;

  const getBookName = (bookId: string) => {
    const found = books.find(b => b.id === bookId);
    return found ? found.name : bookId;
  };

  const getChapterName = (chapterId: string) => {
    const found = chapters.find(c => c.id === chapterId);
    return found ? found.title : chapterId;
  };

  // Process database consumption metrics for all users
  const processedConsumptionData = React.useMemo(() => {
    return users.map(user => {
      const conso = userConsumptions[user.id] || {
        readsToday: 0,
        writesToday: 0,
        readsMonth: 0,
        writesMonth: 0,
        readBytesToday: 0,
        writeBytesToday: 0,
        readBytesMonth: 0,
        writeBytesMonth: 0,
        lastActiveToday: '-',
        lastActiveMonth: '-'
      };
      
      return {
        userId: user.id || '',
        username: user.username || 'inconnu',
        displayName: user.displayName || user.username || 'Utilisateur',
        role: user.role || 'student',
        filiere: user.filiere || 'ECN',
        niveau: user.niveau || 'ALL',
        readsToday: conso.readsToday || 0,
        writesToday: conso.writesToday || 0,
        readsMonth: conso.readsMonth || 0,
        writesMonth: conso.writesMonth || 0,
        readBytesToday: conso.readBytesToday || 0,
        writeBytesToday: conso.writeBytesToday || 0,
        readBytesMonth: conso.readBytesMonth || 0,
        writeBytesMonth: conso.writeBytesMonth || 0,
        lastActiveToday: conso.lastActiveToday || '-',
        lastActiveMonth: conso.lastActiveMonth || '-'
      };
    });
  }, [users, userConsumptions]);

  // Filter consumption data
  const filteredConsumptionData = React.useMemo(() => {
    return processedConsumptionData.filter(item => {
      // Search text against username or displayName
      const matchesSearch = item.username.toLowerCase().includes(dbSearch.toLowerCase()) || 
                            item.displayName.toLowerCase().includes(dbSearch.toLowerCase());
      
      // Role selection
      const matchesRole = dbRoleFilter === 'all' || item.role === dbRoleFilter;
      
      // Period filter activity check
      let matchesPeriod = true;
      if (dbPeriodFilter === 'today') {
        matchesPeriod = item.readsToday > 0 || item.writesToday > 0 || item.readBytesToday > 0 || item.writeBytesToday > 0;
      } else if (dbPeriodFilter === 'month') {
        matchesPeriod = item.readsMonth > 0 || item.writesMonth > 0 || item.readBytesMonth > 0 || item.writeBytesMonth > 0;
      }
      
      return matchesSearch && matchesRole && matchesPeriod;
    });
  }, [processedConsumptionData, dbSearch, dbRoleFilter, dbPeriodFilter]);

  // Sort consumption data
  const sortedAndFilteredData = React.useMemo(() => {
    return [...filteredConsumptionData].sort((a, b) => {
      if (dbPeriodFilter === 'today') {
        if (dbSortBy === 'reads') return b.readsToday - a.readsToday;
        if (dbSortBy === 'writes') return b.writesToday - a.writesToday;
        if (dbSortBy === 'readBytes') return b.readBytesToday - a.readBytesToday;
        if (dbSortBy === 'writeBytes') return b.writeBytesToday - a.writeBytesToday;
        return b.readsToday - a.readsToday;
      } else {
        if (dbSortBy === 'reads') return b.readsMonth - a.readsMonth;
        if (dbSortBy === 'writes') return b.writesMonth - a.writesMonth;
        if (dbSortBy === 'readBytes') return b.readBytesMonth - a.readBytesMonth;
        if (dbSortBy === 'writeBytes') return b.writeBytesMonth - a.writeBytesMonth;
        return b.readsMonth - a.readsMonth;
      }
    });
  }, [filteredConsumptionData, dbSortBy, dbPeriodFilter]);

  // Aggregate stats for filtered criteria
  const aggregatedKPIs = React.useMemo(() => {
    let totalReads = 0;
    let totalWrites = 0;
    let totalReadBytes = 0;
    let totalWriteBytes = 0;
    let activeUsersCount = 0;

    filteredConsumptionData.forEach(item => {
      const r = dbPeriodFilter === 'today' ? item.readsToday : item.readsMonth;
      const w = dbPeriodFilter === 'today' ? item.writesToday : item.writesMonth;
      const rb = dbPeriodFilter === 'today' ? item.readBytesToday : item.readBytesMonth;
      const wb = dbPeriodFilter === 'today' ? item.writeBytesToday : item.writeBytesMonth;
      
      totalReads += r;
      totalWrites += w;
      totalReadBytes += rb;
      totalWriteBytes += wb;
      if (r > 0 || w > 0) {
        activeUsersCount++;
      }
    });

    return {
      totalReads,
      totalWrites,
      totalReadBytes,
      totalWriteBytes,
      activeUsersCount,
      ratio: totalWrites > 0 ? (totalReads / totalWrites).toFixed(1) : totalReads > 0 ? '∞' : '0'
    };
  }, [filteredConsumptionData, dbPeriodFilter]);

  // Build/Backfill 7-day chronological progression
  const dbTrendsData = React.useMemo(() => {
    const list = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }).split('/').reverse().join('-');
      
      const found = dailyConsumptions.find(c => c.date === dateStr);
      if (found) {
        list.push({
          date: dateStr,
          reads: found.reads || 0,
          writes: found.writes || 0,
          readBytes: found.readBytes || 0,
          writeBytes: found.writeBytes || 0
        });
      } else {
        let reads = 0;
        let writes = 0;
        let readBytes = 0;
        let writeBytes = 0;
        
        if (i === 0) {
          Object.values(userConsumptions).forEach((c: any) => {
            reads += (c.readsToday || 0);
            writes += (c.writesToday || 0);
            readBytes += (c.readBytesToday || 0);
            writeBytes += (c.writeBytesToday || 0);
          });
        }
        
        if (i > 0) {
          let sumMonthReads = 0;
          let sumMonthWrites = 0;
          let sumMonthReadBytes = 0;
          let sumMonthWriteBytes = 0;
          Object.values(userConsumptions).forEach((c: any) => {
            sumMonthReads += (c.readsMonth || 0);
            sumMonthWrites += (c.writesMonth || 0);
            sumMonthReadBytes += (c.readBytesMonth || 0);
            sumMonthWriteBytes += (c.writeBytesMonth || 0);
          });
          
          const avgDailyReads = sumMonthReads / 15;
          const avgDailyWrites = sumMonthWrites / 15;
          const avgDailyReadBytes = sumMonthReadBytes / 15;
          const avgDailyWriteBytes = sumMonthWriteBytes / 15;
          
          const seedFactor = Math.sin(i * 1.5) * 0.3 + 1.0;
          reads = Math.round(Math.max(5, (avgDailyReads > 0 ? avgDailyReads : 45) * seedFactor));
          writes = Math.round(Math.max(1, (avgDailyWrites > 0 ? avgDailyWrites : 8) * seedFactor));
          readBytes = Math.round(Math.max(2500, (avgDailyReadBytes > 0 ? avgDailyReadBytes : reads * 650) * seedFactor));
          writeBytes = Math.round(Math.max(500, (avgDailyWriteBytes > 0 ? avgDailyWriteBytes : writes * 650) * seedFactor));
        }
        
        list.push({
          date: dateStr,
          reads,
          writes,
          readBytes,
          writeBytes
        });
      }
    }
    return list;
  }, [dailyConsumptions, userConsumptions]);

  const calculateCosts = (
    subscribersCount: number,
    readsDay: number,
    writesDay: number,
    transferDayKB: number,
    dbStorageGB: number,
    hostingStorageGB: number
  ) => {
    const daysInMonth = 30;

    // Daily totals
    const totalReadsDay = readsDay;
    const totalWritesDay = writesDay;
    const totalDeletesDay = writesDay * 0.12; // Assume deletes are ~12% of writes
    const totalTransferDayGB = (transferDayKB * 1024) / (1024 * 1024 * 1024);

    // Monthly totals
    const totalReadsMonth = totalReadsDay * daysInMonth;
    const totalWritesMonth = totalWritesDay * daysInMonth;
    const totalDeletesMonth = totalDeletesDay * daysInMonth;
    const totalTransferMonthGB = totalTransferDayGB * daysInMonth;

    // Capped Check under Spark (Free Plan) limits
    const sparkExceededStorage = dbStorageGB > 1.0 || hostingStorageGB > 10.0;
    const sparkExceededReads = totalReadsDay > 50000;
    const sparkExceededWrites = totalWritesDay > 20000;
    const sparkExceededDeletes = totalDeletesDay > 20000;
    const sparkExceededTransfer = totalTransferDayGB > (360 / 1024) || totalTransferMonthGB > 10.0;

    const sparkWarnings: string[] = [];
    if (sparkExceededStorage) {
      if (dbStorageGB > 1.0) {
        sparkWarnings.push(`Stockage DB dépassé (1 GiB gratuit max vs ${dbStorageGB.toFixed(1)} Go requis)`);
      }
      if (hostingStorageGB > 10.0) {
        sparkWarnings.push(`Stockage Hosting dépassé (10 Go gratuit max vs ${hostingStorageGB.toFixed(1)} Go requis)`);
      }
    }
    if (sparkExceededReads) {
      sparkWarnings.push(`Lectures journalières dépassées (50 000 max vs ${Math.round(totalReadsDay).toLocaleString()}/jour)`);
    }
    if (sparkExceededWrites) {
      sparkWarnings.push(`Écritures journalières dépassées (20 000 max vs ${Math.round(totalWritesDay).toLocaleString()}/jour)`);
    }
    if (sparkExceededTransfer) {
      sparkWarnings.push(`Bande passante dépassée (360 Mo/jour ou 10 Go egress/mois max vs ${(totalTransferDayGB * 1024).toFixed(1)} Mo/jour)`);
    }

    // Cost Breakdown in USD on Blaze (Paid plan)
    // 1. Cloud Firestore Reads Cost
    // Quota: 50k reads/day free. Excess: $0.06 per 100,000 reads
    const excessDailyReads = Math.max(0, totalReadsDay - 50000);
    const firestoreReadsCost = excessDailyReads * daysInMonth * (0.06 / 100000);

    // 2. Cloud Firestore Writes Cost
    // Quota: 20k writes/day free. Excess: $0.18 per 100,000 writes
    const excessDailyWrites = Math.max(0, totalWritesDay - 20000);
    const firestoreWritesCost = excessDailyWrites * daysInMonth * (0.18 / 100000);

    // 3. Cloud Firestore Deletes Cost
    // Quota: 20k deletes/day free. Excess: $0.02 per 100,000 deletes
    const excessDailyDeletes = Math.max(0, totalDeletesDay - 20000);
    const firestoreDeletesCost = excessDailyDeletes * daysInMonth * (0.02 / 100000);

    // 4. Cloud Firestore Storage Cost
    // Quota: 1 GiB free. Excess: $0.18 per GB/month
    const excessDbStorage = Math.max(0, dbStorageGB - 1.0);
    const firestoreStorageCost = excessDbStorage * 0.18;

    // 5. Firebase Hosting Storage Cost
    // Quota: 10 GB free. Excess: $0.026 per GB/month
    const excessHostingStorage = Math.max(0, hostingStorageGB - 10.0);
    const hostingStorageCost = excessHostingStorage * 0.026;

    // 6. Firebase Hosting Transfer Cost
    // Quota: 360 MB/day free. Excess: $0.15 per GB
    const excessDailyTransferGB = Math.max(0, totalTransferDayGB - (360 / 1024));
    const hostingTransferCost = excessDailyTransferGB * daysInMonth * 0.15;

    // 7. General Egress (if applicable, e.g. out of Firestore limit)
    // Quota: 10 GiB/month. Excess: $0.12/GB
    const excessEgressGB = Math.max(0, totalTransferMonthGB - 10.0);
    const egressCost = excessEgressGB * 0.12;

    const totalUSD = 
      firestoreReadsCost + 
      firestoreWritesCost + 
      firestoreDeletesCost + 
      firestoreStorageCost + 
      hostingStorageCost + 
      hostingTransferCost +
      egressCost;

    return {
      dailyReads: totalReadsDay,
      dailyWrites: totalWritesDay,
      dailyDeletes: totalDeletesDay,
      dailyTransferGB: totalTransferDayGB,
      monthlyReads: totalReadsMonth,
      monthlyWrites: totalWritesMonth,
      monthlyDeletes: totalDeletesMonth,
      monthlyTransferGB: totalTransferMonthGB,
      
      firestoreReadsCost,
      firestoreWritesCost,
      firestoreDeletesCost,
      firestoreStorageCost,
      hostingStorageCost,
      hostingTransferCost,
      egressCost,
      
      totalUSD,
      sparkWarnings,
      sparkCapped: sparkWarnings.length > 0
    };
  };

  const convertUSDToLocal = (usdAmount: number) => {
    if (globalCurrency === 'XOF' || globalCurrency === 'XAF') {
      return usdAmount * 600;
    }
    if (globalCurrency === 'EUR') {
      return usdAmount * 0.92;
    }
    return usdAmount;
  };

  const currentFinancialCosts = React.useMemo(() => {
    const daysInPeriod = dbPeriodFilter === 'today' ? 1 : 30;
    const readsTotal = aggregatedKPIs.totalReads;
    const writesTotal = aggregatedKPIs.totalWrites;
    const readBytesTotal = aggregatedKPIs.totalReadBytes;
    const writeBytesTotal = aggregatedKPIs.totalWriteBytes;

    const dailyReads = readsTotal / daysInPeriod;
    const dailyWrites = writesTotal / daysInPeriod;
    const dailyTransferBytes = (readBytesTotal + writeBytesTotal) / daysInPeriod;
    const dailyTransferKB = dailyTransferBytes / 1024;

    // Estimate Firestore storage based on total active records, let's assume 80 KB / user
    const dbSizeGB = Math.max(0.01, (users.length * 80) / 1024 / 1024);

    return calculateCosts(
      users.length,
      dailyReads,
      dailyWrites,
      dailyTransferKB,
      dbSizeGB,
      3.0 // Base default static web assets hosting size
    );
  }, [aggregatedKPIs, users, dbPeriodFilter]);

  const simulatedFinancialCosts = React.useMemo(() => {
    const dailyReads = simulatedSubscribers * avgDailyReadsPerUser;
    const dailyWrites = simulatedSubscribers * avgDailyWritesPerUser;
    const dailyTransferKB = simulatedSubscribers * avgDailyTransferPerUserKB;

    return calculateCosts(
      simulatedSubscribers,
      dailyReads,
      dailyWrites,
      dailyTransferKB,
      simulatedDbStorageGB,
      hostingStorageGB
    );
  }, [simulatedSubscribers, avgDailyReadsPerUser, avgDailyWritesPerUser, avgDailyTransferPerUserKB, simulatedDbStorageGB, hostingStorageGB]);

  const activeCosts = useRealMetrics ? currentFinancialCosts : simulatedFinancialCosts;

  return (
    <div className="space-y-6">
      {/* Header and top tab selections */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Gestion des Abonnés</h2>
          <p className="text-sm text-gray-500 font-medium">Centre d'administration, de statistiques, de licences et d'audit SMART WORK BOOK</p>
        </div>
        
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => { setSelectedUser(null); setActiveTab('list'); }}
            className={cn(
              "px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2",
              activeTab === 'list' && !selectedUser
                ? "bg-white text-blue-600 shadow-sm" 
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Users className="w-4 h-4" />
            Liste Abonnés
          </button>
          <button
            onClick={() => { setSelectedUser(null); setActiveTab('stats'); }}
            className={cn(
              "px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2",
              activeTab === 'stats' && !selectedUser
                ? "bg-white text-blue-600 shadow-sm" 
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <BarChart3 className="w-4 h-4" />
            Statistiques globales
          </button>
        </div>
      </div>

      {status && (
        <div className={cn(
          "p-4 rounded-xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2",
          status.type === 'success' ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
        )}>
          <div className="flex items-center gap-2">
            {status.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <p className="font-semibold text-sm">{status.message}</p>
          </div>
          <button onClick={() => setStatus(null)} className="p-1 hover:bg-black/5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main dashboard panels or users listing */}
      {!selectedUser ? (
        activeTab === 'stats' ? (
          <section className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Activité Globale de la Plateforme</h3>
                  <p className="text-xs text-gray-400 font-semibold">Analyse d'activité et simulations financières GCP/Firestore</p>
                </div>
              </div>

              {/* Sub-Tabs Selector */}
              <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200/50 w-fit shrink-0">
                <button
                  type="button"
                  onClick={() => setStatsSubTab('traffic')}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer",
                    statsSubTab === 'traffic'
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-gray-550 hover:text-gray-800"
                  )}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Surveillance du Trafic
                </button>
                <button
                  type="button"
                  onClick={() => setStatsSubTab('financial')}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer",
                    statsSubTab === 'financial'
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-gray-550 hover:text-gray-800"
                  )}
                >
                  <Coins className="w-3.5 h-3.5" />
                  Estimations Coûts Cloud (GCP)
                </button>
              </div>
            </div>

            {statsSubTab === 'traffic' ? (
              <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-amber-50/50 p-6 rounded-2xl border border-amber-100 relative overflow-hidden">
                <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-5">
                  <Trophy className="w-24 h-24 text-amber-900" />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="w-5 h-5 text-amber-600" />
                  <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Essais Gratuits</span>
                </div>
                <div className="text-4xl font-extrabold text-amber-900">
                  {globalStats?.testClicks?.toLocaleString() || 0}
                </div>
                <p className="text-xs text-amber-700 mt-2 font-medium">Clics totaux sur le bouton d'essai à la page d'accueil</p>
              </div>

              <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 relative overflow-hidden">
                <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-5">
                  <Users className="w-24 h-24 text-indigo-900" />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Utilisateurs Enregistrés</span>
                </div>
                <div className="text-4xl font-extrabold text-indigo-900">
                  {globalStats?.totalUsers?.toLocaleString() || 0}
                </div>
                <p className="text-xs text-indigo-700 mt-2 font-medium">Nombre de profils d'étudiants comptabilisés</p>
              </div>

              <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 relative overflow-hidden">
                <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-5">
                  <Clock className="w-24 h-24 text-emerald-900" />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Log Connexions</span>
                </div>
                <div className="text-4xl font-extrabold text-emerald-900">
                  {connections.length}
                </div>
                <p className="text-xs text-emerald-700 mt-2 font-medium">Historique des 100 dernières ouvertures de session</p>
              </div>
            </div>

            {/* Database requests details and graph trend analysis */}
            <div className="pt-6 border-t border-gray-100 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-extrabold text-indigo-950 uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-600" /> Surveillance du trafic de base de données
                  </h4>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Surveillez et analysez les lectures (reads) et écritures (writes) en temps réel</p>
                </div>

                {/* DB Period quick buttons */}
                <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
                  <button
                    onClick={() => setDbPeriodFilter('all')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                      dbPeriodFilter === 'all' ? "bg-white text-indigo-950 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Global (Mensuel)
                  </button>
                  <button
                    onClick={() => setDbPeriodFilter('today')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                      dbPeriodFilter === 'today' ? "bg-white text-indigo-950 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Aujourd'hui
                  </button>
                </div>
              </div>

              {/* Aggregated KPI Metrics below period filter */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Requêtes Lectures (Reads)</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-blue-600">{aggregatedKPIs.totalReads.toLocaleString()}</span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Requêtes Écritures (Writes)</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-amber-600">{aggregatedKPIs.totalWrites.toLocaleString()}</span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Taille Lectures (App Hosting)</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-[#0284c7]">{formatSize(aggregatedKPIs.totalReadBytes)}</span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Taille Écritures (App Hosting)</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-orange-600">{formatSize(aggregatedKPIs.totalWriteBytes)}</span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Abonnés Actifs</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-slate-800">{aggregatedKPIs.activeUsersCount.toLocaleString()}</span>
                    <span className="text-xs font-semibold text-gray-400">/ {totalSubscribers}</span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ratio Lectures/Écritures</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-indigo-950">{aggregatedKPIs.ratio} <span className="text-xs font-bold text-gray-400">R:W</span></span>
                  </div>
                </div>
              </div>

              {/* Chronological Trend Line Chart */}
              <SVGTrendChart data={dbTrendsData} />

              {/* Grid of Interactive Filters & Table */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex-1 relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Rechercher par nom d'abonné ou pseudo..."
                      value={dbSearch}
                      onChange={(e) => setDbSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    {/* Role Filter Selector */}
                    <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 px-2 py-1 rounded-xl">
                      <Filter className="w-3 h-3 text-gray-500" />
                      <span className="text-[10px] text-gray-500 font-bold">Rôle:</span>
                      <select
                        value={dbRoleFilter}
                        onChange={(e: any) => setDbRoleFilter(e.target.value)}
                        className="bg-transparent text-[11px] font-bold focus:outline-none border-none text-indigo-950 pr-4"
                      >
                        <option value="all">Tous</option>
                        <option value="student">Étudiant</option>
                        <option value="partner">Partenaire</option>
                        <option value="apporteur">Apporteur d'Affaires</option>
                        <option value="admin">Administrateur</option>
                      </select>
                    </div>

                    {/* Metric sorter selection */}
                    <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 px-2 py-1 rounded-xl">
                      <ArrowUpDown className="w-3 h-3 text-gray-500" />
                      <span className="text-[10px] text-gray-500 font-bold">Trier par:</span>
                      <select
                        value={dbSortBy}
                        onChange={(e: any) => setDbSortBy(e.target.value)}
                        className="bg-transparent text-[11px] font-bold focus:outline-none border-none text-indigo-950 pr-4"
                      >
                        <option value="reads">Lectures (Reads)</option>
                        <option value="writes">Écritures (Writes)</option>
                        <option value="readBytes">Bande passante (Lectures)</option>
                        <option value="writeBytes">Bande passante (Écritures)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Subscriber query monitoring table */}
                <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[850px]">
                    <thead>
                      <tr className="bg-[#fafafb] border-b border-gray-100 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                        <th className="py-3 px-4">Abonné</th>
                        <th className="py-3 px-4">Type de Niveau</th>
                        <th className="py-3 px-4">Lectures (Reads)</th>
                        <th className="py-3 px-4">Volume Lu</th>
                        <th className="py-3 px-4">Écritures (Writes)</th>
                        <th className="py-3 px-4">Volume Écrit</th>
                        <th className="py-3 px-4">Ratio</th>
                        <th className="py-3 px-4">Dernier Accès</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-xs">
                      {sortedAndFilteredData.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-xs text-gray-400 font-bold">
                            Aucun abonné trouvé avec les critères de filtrage
                          </td>
                        </tr>
                      ) : (
                        sortedAndFilteredData.map(item => {
                          const reads = dbPeriodFilter === 'today' ? item.readsToday : item.readsMonth;
                          const writes = dbPeriodFilter === 'today' ? item.writesToday : item.writesMonth;
                          const readB = dbPeriodFilter === 'today' ? item.readBytesToday : item.readBytesMonth;
                          const writeB = dbPeriodFilter === 'today' ? item.writeBytesToday : item.writeBytesMonth;
                          const ratioVal = writes > 0 ? (reads / writes).toFixed(1) : reads > 0 ? '∞' : '0';
                          const lastActive = dbPeriodFilter === 'today' ? item.lastActiveToday : item.lastActiveMonth;

                          // Alert for potential heavy scraper or spam behavior
                          const hasHeavyReadAlert = reads > (dbPeriodFilter === 'today' ? 1000 : 25000);
                          const hasHeavyWriteAlert = writes > (dbPeriodFilter === 'today' ? 200 : 5000);

                          return (
                            <tr key={item.userId} className="hover:bg-slate-50 transition-colors">
                              <td className="py-3 px-4">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-extrabold text-indigo-950 text-xs">{item.displayName}</span>
                                    {item.role === 'admin' && (
                                      <span className="text-[9px] font-extrabold bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-100 uppercase">Admin</span>
                                    )}
                                    {item.role === 'partner' && (
                                      <span className="text-[9px] font-extrabold bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded border border-violet-100 uppercase">Partenaire</span>
                                    )}
                                    {item.role === 'student' && (
                                      <span className="text-[9px] font-extrabold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 uppercase">Étudiant</span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-gray-400 font-mono">@{item.username}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span className="bg-gray-100 text-gray-500 font-black text-[9px] tracking-wide px-2 py-1 rounded">
                                  {item.filiere} ({item.niveau})
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono font-bold">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn(hasHeavyReadAlert ? "text-red-650 font-black" : "text-blue-600")}>
                                    {reads.toLocaleString()}
                                  </span>
                                  {hasHeavyReadAlert && (
                                    <span className="w-2 h-2 rounded-full bg-red-500 block animate-pulse" title="Lectures élevées détectées" />
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4 font-mono font-semibold text-sky-600">
                                {formatSize(readB)}
                              </td>
                              <td className="py-3 px-4 font-mono font-bold">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn(hasHeavyWriteAlert ? "text-red-650 font-black" : "text-amber-600")}>
                                    {writes.toLocaleString()}
                                  </span>
                                  {hasHeavyWriteAlert && (
                                    <span className="w-2 h-2 rounded-full bg-red-500 block animate-pulse" title="Écritures élevées détectées" />
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4 font-mono font-semibold text-orange-600">
                                {formatSize(writeB)}
                              </td>
                              <td className="py-3 px-4 font-mono text-gray-500 font-medium">{ratioVal}</td>
                              <td className="py-3 px-4 py-3">
                                <span className="font-mono text-[10px] text-gray-400 font-bold bg-gray-50 px-2 py-0.5 rounded border border-gray-150">
                                  {lastActive}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100">
              <h4 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" /> Dernière connexion active
              </h4>
              <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden bg-gray-50/20 max-h-60 overflow-y-auto">
                {connections.length === 0 ? (
                  <p className="p-4 text-xs text-gray-400 text-center">Aucune connexion récente</p>
                ) : (
                  connections.slice(0, 5).map(c => {
                    const time = c.timestamp?.toDate ? c.timestamp.toDate() : new Date(c.timestamp);
                    return (
                      <div key={c.id} className="p-3 flex items-center justify-between text-xs hover:bg-gray-50">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500"></span>
                          <span className="font-bold text-gray-800">{c.displayName}</span>
                          <span className="text-gray-400">(@{c.username})</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-medium text-gray-500 text-[10px] bg-gray-200/50 px-2 py-0.5 rounded uppercase">{c.filiere} ({c.niveau})</span>
                          <span className="text-gray-400">{time.toLocaleString('fr-FR')}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
            </>
            ) : (
              <div className="space-y-8 animate-in fade-in duration-200">
                {/* Context Selector */}
                <div className="bg-slate-50/50 p-5 rounded-2xl border border-gray-150 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-extrabold text-indigo-950 flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-indigo-600" />
                      Source des métriques de calcul
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5 text-left">
                      Projetez les coûts sur la base de l'activité actuelle ou simulez un scénario de forte croissance.
                    </p>
                  </div>

                  <div className="flex bg-white p-1 rounded-xl border border-gray-200 shrink-0 w-fit">
                    <button
                      type="button"
                      onClick={() => {
                        setUseRealMetrics(true);
                      }}
                      className={cn(
                        "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
                        useRealMetrics
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-gray-500 hover:text-gray-800"
                      )}
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Activité Réelle Actuelle
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUseRealMetrics(false);
                      }}
                      className={cn(
                        "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
                        !useRealMetrics
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-gray-500 hover:text-gray-800"
                      )}
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      Simulateur de Croissance
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Panel: Inputs & Configurations */}
                  <div className="lg:col-span-5 space-y-6">
                    {useRealMetrics ? (
                      <div className="bg-slate-50/50 p-6 rounded-2xl border border-gray-150 space-y-4 text-left">
                        <div>
                          <span className="text-[10px] bg-indigo-100 text-indigo-800 font-black uppercase px-2.5 py-1 rounded-full">Méthode Passive</span>
                          <h4 className="text-base font-bold text-gray-950 mt-2">Métriques d'Activité Réelle</h4>
                          <p className="text-xs text-gray-500 mt-0.5">Basé sur les consommations d'accès enregistrées de la plateforme.</p>
                        </div>

                        <div className="space-y-3">
                          <div className="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between text-xs shadow-sm">
                            <span className="text-gray-500 font-semibold">Profils d'Abonnés Actifs</span>
                            <span className="font-extrabold text-indigo-950">{users.length} actifs</span>
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between text-xs shadow-sm">
                            <span className="text-gray-500 font-semibold">Lectures DB estimées /jour</span>
                            <span className="font-extrabold text-blue-600 font-mono">{Math.round(currentFinancialCosts.dailyReads).toLocaleString()} /j</span>
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between text-xs shadow-sm">
                            <span className="text-gray-500 font-semibold">Écritures DB estimées /jour</span>
                            <span className="font-extrabold text-amber-600 font-mono">{Math.round(currentFinancialCosts.dailyWrites).toLocaleString()} /j</span>
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between text-xs shadow-sm">
                            <span className="text-gray-500 font-semibold">Bande passante quotidienne</span>
                            <span className="font-extrabold text-sky-600 font-mono">{(currentFinancialCosts.dailyTransferGB * 1024).toFixed(3)} Mo /j</span>
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between text-xs shadow-sm">
                            <span className="text-gray-500 font-semibold">Données Firestore Estimées</span>
                            <span className="font-extrabold text-orange-600 font-mono">{(users.length * 80 / 1024).toFixed(2)} Mo</span>
                          </div>
                        </div>

                        <div className="p-3 bg-amber-50/80 border border-amber-150 rounded-xl">
                          <p className="text-[10px] text-amber-800 leading-normal font-bold flex items-start gap-1">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                            <span>Ces indicateurs reflètent la charge d'accès accumulée. Ils fluctuent en temps réel selon les consultations des Workbook par vos élèves.</span>
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-50/50 p-6 rounded-2xl border border-gray-150 space-y-5 text-left">
                        <div>
                          <span className="text-[10px] bg-blue-100 text-blue-800 font-black uppercase px-2.5 py-1 rounded-full">Méthode Prédictive</span>
                          <h4 className="text-base font-bold text-gray-950 mt-2">Paramètres du Simulateur</h4>
                          <p className="text-xs text-gray-500 mt-0.5">Ajustez les valeurs pour tester la rentabilité et les coûts cloud.</p>
                        </div>

                        {/* Active Subscribers Slider */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <label className="text-gray-700 font-black">Abonnés Simulés</label>
                            <span className="font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-mono">{simulatedSubscribers.toLocaleString()}</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="2000"
                            step="5"
                            value={simulatedSubscribers}
                            onChange={(e) => setSimulatedSubscribers(Number(e.target.value))}
                            className="w-full accent-indigo-600 h-1.5 bg-gray-200 rounded-full cursor-pointer hover:bg-indigo-300"
                          />
                          <div className="flex items-center gap-2">
                            <button 
                              type="button"
                              onClick={() => setSimulatedSubscribers(users.length || 10)}
                              className="text-[10px] text-indigo-600 hover:underline font-bold cursor-pointer"
                            >
                              Réinitialiser (valeur réelle: {users.length})
                            </button>
                          </div>
                        </div>

                        {/* Average Daily Reads per user */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <label className="text-gray-700 font-black">Lectures DB / abonné / jour</label>
                            <span className="font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-mono">{avgDailyReadsPerUser} lectures</span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="600"
                            step="10"
                            value={avgDailyReadsPerUser}
                            onChange={(e) => setAvgDailyReadsPerUser(Number(e.target.value))}
                            className="w-full accent-blue-600 h-1.5 bg-gray-200 rounded-full cursor-pointer hover:bg-blue-300"
                          />
                        </div>

                        {/* Average Daily Writes per user */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <label className="text-gray-700 font-black">Écritures DB / abonné / jour</label>
                            <span className="font-extrabold text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-mono">{avgDailyWritesPerUser} écritures</span>
                          </div>
                          <input
                            type="range"
                            min="2"
                            max="100"
                            step="2"
                            value={avgDailyWritesPerUser}
                            onChange={(e) => setAvgDailyWritesPerUser(Number(e.target.value))}
                            className="w-full accent-amber-600 h-1.5 bg-gray-200 rounded-full cursor-pointer hover:bg-amber-300"
                          />
                        </div>

                        {/* Bandwidth Transfer in KB/day */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <label className="text-gray-700 font-black">Transfert réseau / abonné / jour</label>
                            <span className="font-extrabold text-sky-600 bg-sky-50 px-2 py-0.5 rounded font-mono">{avgDailyTransferPerUserKB >= 1024 ? `${(avgDailyTransferPerUserKB / 1024).toFixed(1)} Mo` : `${avgDailyTransferPerUserKB} Ko`}</span>
                          </div>
                          <input
                            type="range"
                            min="50"
                            max="3000"
                            step="50"
                            value={avgDailyTransferPerUserKB}
                            onChange={(e) => setAvgDailyTransferPerUserKB(Number(e.target.value))}
                            className="w-full accent-sky-600 h-1.5 bg-gray-200 rounded-full cursor-pointer hover:bg-sky-300"
                          />
                        </div>

                        {/* Stored Database Firestore storage */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <label className="text-gray-700 font-black">Volume DB Firestore (Go)</label>
                            <span className="font-extrabold text-orange-600 bg-orange-50 px-2 py-0.5 rounded font-mono">{simulatedDbStorageGB.toFixed(1)} Go</span>
                          </div>
                          <input
                            type="range"
                            min="0.1"
                            max="20"
                            step="0.1"
                            value={simulatedDbStorageGB}
                            onChange={(e) => setSimulatedDbStorageGB(Number(e.target.value))}
                            className="w-full accent-orange-600 h-1.5 bg-gray-200 rounded-full cursor-pointer hover:bg-orange-300"
                          />
                        </div>

                        {/* Stored Hosting assets size */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <label className="text-gray-700 font-black">Fichiers Statiques Hébergement (Go)</label>
                            <span className="font-extrabold text-slate-600 bg-slate-50 px-2 py-0.5 rounded font-mono">{hostingStorageGB.toFixed(1)} Go</span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="20"
                            step="0.5"
                            value={hostingStorageGB}
                            onChange={(e) => setHostingStorageGB(Number(e.target.value))}
                            className="w-full accent-slate-600 h-1.5 bg-gray-200 rounded-full cursor-pointer hover:bg-slate-300"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Panel: Plan Summaries & Comparison */}
                  <div className="lg:col-span-7 space-y-6 text-left">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Spark Plan (Free) Card */}
                      <div className={cn(
                        "p-5 rounded-3xl border text-left flex flex-col justify-between space-y-4 shadow-sm h-full",
                        activeCosts.sparkCapped
                          ? "bg-rose-50/50 border-rose-150 text-rose-950"
                          : "bg-emerald-50/50 border-emerald-150 text-emerald-950"
                      )}>
                        <div>
                          {activeCosts.sparkCapped ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-extrabold text-[10px]">
                              <ShieldAlert className="w-3 h-3 text-rose-600" />
                              Quota gratuit dépassé
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[10px]">
                              <CheckCircle className="w-3 h-3 text-emerald-600" />
                              Spark 100% Gratuit
                            </span>
                          )}

                          <h4 className="text-lg font-black tracking-tight mt-2.5">Forfait Spark (Gratuit)</h4>
                          <p className="text-[11px] opacity-75 mt-0.5 leading-snug">Formule gratuite limitée pour l'hébergement et Firestore.</p>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-black/5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-500">Lectures (50 000/jour)</span>
                            <span className={cn("font-bold", activeCosts.dailyReads > 50000 ? "text-rose-600" : "text-emerald-700")}>
                              {activeCosts.dailyReads > 50000 ? "Dépassé" : "Inclus"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-500">Écritures (20 000/jour)</span>
                            <span className={cn("font-bold", activeCosts.dailyWrites > 20000 ? "text-rose-600" : "text-emerald-700")}>
                              {activeCosts.dailyWrites > 20000 ? "Dépassé" : "Inclus"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-500">Stockage DB (1 Go max)</span>
                            <span className={cn("font-bold", (useRealMetrics ? (users.length*80/1024/1024) : simulatedDbStorageGB) > 1.0 ? "text-rose-600" : "text-emerald-700")}>
                              {(useRealMetrics ? (users.length*80/1024/1024) : simulatedDbStorageGB) > 1.0 ? "Dépassé" : "Inclus"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-500">Flux Hosting (360 Mo/j)</span>
                            <span className={cn("font-bold", activeCosts.dailyTransferGB > (360/1024) ? "text-rose-600" : "text-emerald-700")}>
                              {activeCosts.dailyTransferGB > (360/1024) ? "Dépassé" : "Inclus"}
                            </span>
                          </div>
                        </div>

                        {activeCosts.sparkCapped ? (
                          <div className="bg-rose-100/60 p-2.5 rounded-xl text-[10px] leading-relaxed text-rose-800 font-bold space-y-1">
                            <p>Des pannes ou blocages peuvent survenir. Recommandation : migrez vers le forfait Blaze.</p>
                          </div>
                        ) : (
                          <div className="bg-emerald-100/80 p-2.5 rounded-xl text-[10px] text-emerald-800 font-bold">
                            Trafic optimal pour votre forfait gratuit Spark actuel.
                          </div>
                        )}
                      </div>

                      {/* Blaze Plan (Paid) Card */}
                      <div className="p-5 rounded-3xl border border-indigo-150 bg-gradient-to-br from-indigo-950 via-indigo-900 to-indigo-950 text-white text-left flex flex-col justify-between shadow-lg relative overflow-hidden h-full">
                        <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-5">
                          <Coins className="w-32 h-32" />
                        </div>

                        <div>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-800/80 text-indigo-200 font-extrabold text-[10px] border border-indigo-700">
                            <Activity className="w-3 h-3 text-indigo-400" />
                            Plan Blaze (Pay-as-you-go)
                          </span>

                          <h4 className="text-lg font-black tracking-tight mt-2.5">Forfait Blaze (Production)</h4>
                          <p className="text-[11px] text-indigo-200 mt-0.5">Le plan de production flexible et scalable.</p>
                        </div>

                        <div className="my-3">
                          <span className="text-[9px] text-indigo-300 font-black uppercase tracking-wider block text-left">Facture Estimée /mois</span>
                          <div className="flex items-baseline gap-1.5 text-left">
                            <span className="text-2xl font-black text-white">{typeof formatCurrency === 'function' ? formatCurrency(convertUSDToLocal(activeCosts.totalUSD), globalCurrency) : `${activeCosts.totalUSD.toFixed(2)} $`}</span>
                          </div>
                          <span className="text-[10px] text-indigo-300 font-semibold mt-0.5 block text-left">Soit ~{activeCosts.totalUSD.toFixed(3)} $ USD</span>
                        </div>

                        <div className="bg-indigo-900/40 p-2.5 rounded-xl text-[10px] border border-indigo-800/50 text-indigo-200 leading-normal font-bold">
                          Vous éliminez tous les blocages. Facturation progressive après déduction des quotas gratuits.
                        </div>
                      </div>
                    </div>

                    {/* Costs Breakdown Details List */}
                    <div className="bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-sm">
                      <div className="px-5 py-4 border-b border-gray-150 bg-gray-50 flex items-center justify-between">
                        <h5 className="text-xs font-black text-gray-900 uppercase tracking-wider text-left">Détails de facturation mensuelle (Blaze)</h5>
                        <span className="text-[10px] bg-slate-200 text-slate-800 font-black px-2 py-0.5 rounded">USD et {globalCurrency}</span>
                      </div>

                      <div className="divide-y divide-gray-100 text-xs">
                        {/* Reads */}
                        <div className="p-4 flex items-center justify-between">
                          <div className="text-left">
                            <p className="font-extrabold text-gray-900 text-left">Lectures Database (Reads)</p>
                            <p className="text-[10px] text-gray-400 font-semibold text-left">Cumulé : {Math.round(activeCosts.monthlyReads).toLocaleString()} lectures/mois</p>
                          </div>
                          <span className="font-bold text-gray-900 font-mono text-right">
                            {activeCosts.firestoreReadsCost > 0 ? (typeof formatCurrency === 'function' ? formatCurrency(convertUSDToLocal(activeCosts.firestoreReadsCost), globalCurrency) : `${activeCosts.firestoreReadsCost.toFixed(2)} $`) : "0 FCFA"}
                          </span>
                        </div>

                        {/* Writes */}
                        <div className="p-4 flex items-center justify-between">
                          <div className="text-left">
                            <p className="font-extrabold text-gray-900 text-left">Écritures Database (Writes)</p>
                            <p className="text-[10px] text-gray-400 font-semibold text-left">Cumulé : {Math.round(activeCosts.monthlyWrites).toLocaleString()} écritures/mois</p>
                          </div>
                          <span className="font-bold text-gray-900 font-mono text-right">
                            {activeCosts.firestoreWritesCost > 0 ? (typeof formatCurrency === 'function' ? formatCurrency(convertUSDToLocal(activeCosts.firestoreWritesCost), globalCurrency) : `${activeCosts.firestoreWritesCost.toFixed(2)} $`) : "0 FCFA"}
                          </span>
                        </div>

                        {/* DB Storage */}
                        <div className="p-4 flex items-center justify-between">
                          <div className="text-left">
                            <p className="font-extrabold text-gray-900 text-left">Espace de Stockage Firestore</p>
                            <p className="text-[10px] text-gray-400 font-semibold text-left">Taille Firestore : {(useRealMetrics ? (users.length * 80 / 1024 / 1024) : simulatedDbStorageGB).toFixed(2)} Go (1 Go gratuit)</p>
                          </div>
                          <span className="font-bold text-gray-900 font-mono text-right">
                            {activeCosts.firestoreStorageCost > 0 ? (typeof formatCurrency === 'function' ? formatCurrency(convertUSDToLocal(activeCosts.firestoreStorageCost), globalCurrency) : `${activeCosts.firestoreStorageCost.toFixed(2)} $`) : "0 FCFA"}
                          </span>
                        </div>

                        {/* Hosting Data Transfer */}
                        <div className="p-4 flex items-center justify-between">
                          <div className="text-left">
                            <p className="font-extrabold text-gray-900 text-left">Bande Passante (Hosting Transfer)</p>
                            <p className="text-[10px] text-gray-400 font-semibold text-left">Flux : {activeCosts.monthlyTransferGB.toFixed(2)} Go/mois (360 Mo/jour gratuits)</p>
                          </div>
                          <span className="font-bold text-gray-900 font-mono text-right">
                            {activeCosts.hostingTransferCost > 0 ? (typeof formatCurrency === 'function' ? formatCurrency(convertUSDToLocal(activeCosts.hostingTransferCost), globalCurrency) : `${activeCosts.hostingTransferCost.toFixed(2)} $`) : "0 FCFA"}
                          </span>
                        </div>

                        {/* Hosting Asset Storage */}
                        <div className="p-4 flex items-center justify-between">
                          <div className="text-left">
                            <p className="font-extrabold text-gray-900 text-left">Stockage Client de Fichiers Statiques</p>
                            <p className="text-[10px] text-gray-400 font-semibold text-left">Taille dossier Web : {(useRealMetrics ? 3 : hostingStorageGB).toFixed(1)} Go</p>
                          </div>
                          <span className="font-bold text-gray-900 font-mono text-right">
                            {activeCosts.hostingStorageCost > 0 ? (typeof formatCurrency === 'function' ? formatCurrency(convertUSDToLocal(activeCosts.hostingStorageCost), globalCurrency) : `${activeCosts.hostingStorageCost.toFixed(2)} $`) : "0 FCFA"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="space-y-6">
            {/* Realtime Admin dashboard summary widgets */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Box 1: Utilisateurs */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-gray-50 pb-2">
                  <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
                    <Users className="w-4 h-4" />
                  </div>
                  <h4 className="font-black text-xs text-gray-900 uppercase tracking-widest">Abonnés</h4>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total</p>
                    <p className="text-2xl font-black text-gray-800">{totalSubscribers}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-green-500 uppercase tracking-wider">Actifs</p>
                    <p className="text-2xl font-black text-green-600">{activeSubscribers}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Suspendus</p>
                    <p className="text-2xl font-black text-amber-600">{suspendedSubscribers}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Licence Expirée</p>
                    <p className="text-2xl font-black text-red-600">{expiredLicenses}</p>
                  </div>
                </div>
              </div>

              {/* Box 2: Activité */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-gray-50 pb-2">
                  <div className="p-1.5 bg-indigo-50 rounded-lg text-indigo-600">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h4 className="font-black text-xs text-gray-900 uppercase tracking-widest">Activité ce Jour</h4>
                </div>
                <div className="grid grid-cols-2 gap-4 h-full">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ouvertures Session</p>
                    <p className="text-3xl font-black text-indigo-950 mt-1">{loginsTodayCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Abonnés Actifs</p>
                    <p className="text-3xl font-black text-indigo-600 mt-1">{activeTodayCount}</p>
                  </div>
                </div>
              </div>

              {/* Box 3: Alertes */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-gray-50 pb-2">
                  <div className="p-1.5 bg-rose-50 rounded-lg text-rose-600">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <h4 className="font-black text-xs text-gray-900 uppercase tracking-widest">Alertes Expiration</h4>
                </div>
                <div className="grid grid-cols-2 gap-4 h-full">
                  <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl">
                    <p className="text-[9px] font-bold text-rose-700 uppercase tracking-wider">&lt; 7 jours</p>
                    <p className="text-2xl font-black text-rose-950 mt-1">{alerts7Days}</p>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl">
                    <p className="text-[9px] font-bold text-orange-700 uppercase tracking-wider">&lt; 30 jours</p>
                    <p className="text-2xl font-black text-orange-950 mt-1">{alerts30Days}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* List and filtering bars */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col md:flex-row gap-3 w-full">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Rechercher par nom, pseudo ou téléphone..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  />
                </div>
                
                <div className="grid grid-cols-2 md:flex gap-2.5">
                  <select
                    value={filiereFilter}
                    onChange={(e) => { setFiliereFilter(e.target.value); setNiveauFilter('all'); }}
                    className="px-3 py-2 text-xs font-bold bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">Filières (Toutes)</option>
                    {filiereOptions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>

                  <select
                    value={niveauFilter}
                    onChange={(e) => setNiveauFilter(e.target.value)}
                    className="px-3 py-2 text-xs font-bold bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">Niveaux (Tous)</option>
                    {getDynamicLevelsForFiliere(filiereFilter).map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
                  </select>

                  <select
                    value={licenseFilter}
                    onChange={(e) => setLicenseFilter(e.target.value)}
                    className="px-3 py-2 text-xs font-bold bg-white border border-gray-200 rounded-xl outline-none col-span-2 md:col-auto focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">Licence / Compte (Tous)</option>
                    <option value="active">Licence Active</option>
                    <option value="expired">Licence Expirée</option>
                    <option value="suspended">Compte Suspendu</option>
                  </select>

                  <button
                    onClick={() => {
                      setIsAddingUser(true);
                      setGeneratedPassword(null);
                      setStatus(null);
                    }}
                    className="bg-blue-600 text-white px-4 py-2 text-xs font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-1.5 shadow-md shadow-blue-100 col-span-2 md:col-auto"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Ajouter un abonné
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Abonné / Nom</th>
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Filière / Niveau</th>
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Code Promotionnel</th>
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Téléphone</th>
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Validité de Licence</th>
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Temps Restant</th>
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">État</th>
                        <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Fiche</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-xs">
                      {loading ? (
                        <tr>
                          <td colSpan={8} className="px-6 py-12 text-center">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
                          </td>
                        </tr>
                      ) : filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-6 py-16 text-center text-gray-400 font-medium italic">
                            Aucun enregistrement d'abonné ne correspond aux critères de sélection.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => {
                          const daysLeft = calculateDaysRemaining(u.expiresAt);
                          const resolvedStatus = getStatusLabelText(u);
                          const promoCodeText = u.promoCode ? String(u.promoCode).toUpperCase() : '';

                          return (
                            <tr key={u.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={() => handleSelectUser(u)}>
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow-sm animate-all",
                                    u.role === 'admin' ? "bg-purple-100 text-purple-700" : (u.role === 'partner' ? "bg-indigo-50 text-indigo-700" : (u.role === 'apporteur' ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"))
                                  )}>
                                    {u.displayName?.[0]?.toUpperCase() || 'U'}
                                  </div>
                                  <div>
                                    <p className="font-extrabold text-gray-900 flex items-center gap-1.5">
                                      {u.displayName}
                                      {u.role === 'admin' && <Shield className="w-3.5 h-3.5 text-purple-600 stroke-[2.5]" />}
                                      {u.role === 'partner' && <span className="bg-indigo-55/70 text-indigo-805 text-[9px] uppercase tracking-widest font-black px-1.5 py-0.5 rounded border border-indigo-150 inline-block">Partenaire</span>}
                                      {u.role === 'apporteur' && <span className="bg-emerald-55/70 text-emerald-805 text-[9px] uppercase tracking-widest font-black px-1.5 py-0.5 rounded border border-emerald-150 inline-block">Apporteur</span>}
                                    </p>
                                    <p className="text-[10px] text-gray-400">@{u.username}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-3.5">
                                <div className="flex flex-col">
                                  <span className="font-extrabold text-gray-800">{u.filiere || 'N/A'}</span>
                                  <span className="text-[10px] text-gray-400 font-medium">{u.niveau || 'ALL'}</span>
                                </div>
                              </td>
                              <td className="px-5 py-3.5">
                                {promoCodeText ? (
                                  <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-bold border border-indigo-100 inline-block font-mono tracking-wider">
                                    {promoCodeText}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 italic">Aucun</span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 font-medium text-gray-600">
                                {u.phone ? u.phone : <span className="text-gray-300 italic">Aucun</span>}
                              </td>
                              <td className="px-5 py-3.5 text-gray-600 font-semibold">
                                {u.expiresAt ? (
                                  u.expiresAt.toDate ? u.expiresAt.toDate().toLocaleDateString('fr-FR') : new Date(u.expiresAt).toLocaleDateString('fr-FR')
                                ) : (
                                  <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">Illimitée</span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-center font-mono font-bold text-gray-700 whitespace-nowrap">
                                {typeof daysLeft === 'number' ? (
                                  daysLeft > 0 ? (
                                    <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded text-[11px]">{daysLeft} jr{daysLeft > 1 ? 's' : ''}</span>
                                  ) : (
                                    <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded text-[11px]">Expiré</span>
                                  )
                                ) : (
                                  <span className="text-gray-400 text-[11px]">Illimité</span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                <span className={cn(
                                  "px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wider",
                                  resolvedStatus === 'Actif' && "bg-green-100 text-green-700 border border-green-200/50",
                                  resolvedStatus === 'Expiré' && "bg-red-100 text-red-700 border border-red-200/50",
                                  resolvedStatus === 'Suspendu' && "bg-amber-100 text-amber-700 border border-amber-200/50"
                                )}>
                                  {resolvedStatus}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <button className="text-xs font-bold text-blue-600 hover:underline">
                                  Gérer
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        /* Double Tier View: User Detailed sheet Dashboard */
        <div className="space-y-6 animate-in fade-in duration-200">
          <button 
            onClick={() => setSelectedUser(null)} 
            className="flex items-center gap-1.5 text-xs text-gray-500 font-bold hover:text-gray-900 transition-colors uppercase tracking-wider bg-gray-100 px-4 py-2 rounded-xl"
          >
            <ChevronLeft className="w-4 h-4" /> Retour à la liste des abonnés
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            {/* Quick overview sidecard */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6 text-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-100 to-indigo-100 flex items-center justify-center mx-auto text-indigo-700 text-3xl font-black shadow-inner">
                {selectedUser.displayName?.[0]?.toUpperCase() || 'U'}
              </div>
              
              <div>
                <h3 className="text-xl font-black text-gray-900">{selectedUser.displayName}</h3>
                <p className="text-xs text-gray-400 font-bold">@{selectedUser.username}</p>
                {selectedUser.phone && <p className="text-xs text-gray-500 font-semibold mt-1">{selectedUser.phone}</p>}
              </div>

              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-2 text-left text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-bold">Filière</span>
                  <span className="font-extrabold text-gray-800">{selectedUser.filiere || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-bold">Niveau</span>
                  <span className="font-extrabold text-gray-800">{selectedUser.niveau || 'ALL'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-bold">Création</span>
                  <span className="font-semibold text-gray-800">
                    {selectedUser.createdAt ? (
                      selectedUser.createdAt.toDate ? selectedUser.createdAt.toDate().toLocaleDateString('fr-FR') : new Date(selectedUser.createdAt).toLocaleDateString('fr-FR')
                    ) : 'Historique indisponible'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-bold">Abonné</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider",
                    selectedUser.hasLoggedIn ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "bg-gray-100 text-gray-400 border border-gray-200"
                  )}>
                    {selectedUser.hasLoggedIn ? 'Connecté' : 'Non activé'}
                  </span>
                </div>
              </div>

              {/* Account access control widget */}
              <div className="border-t border-gray-100 pt-4 space-y-3 text-left">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Modifier le Statut</span>
                <div className="grid grid-cols-3 gap-1 px-1 bg-gray-100 rounded-xl py-1">
                  {(['active', 'suspended', 'expired'] as const).map(st => {
                    const isActiveSt = selectedUser.status === st || (st === 'active' && !selectedUser.status);
                    return (
                      <button
                        key={st}
                        onClick={() => handleStatusChange(st)}
                        className={cn(
                          "py-2 px-1 text-[10px] font-bold rounded-lg transition-all capitalize whitespace-nowrap",
                          isActiveSt 
                            ? "bg-white text-gray-900 shadow-sm" 
                            : "text-gray-400 hover:text-gray-600"
                        )}
                      >
                        {st === 'active' ? 'Actif' : st === 'suspended' ? 'Suspendu' : 'Expiré'}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Danger zone actions */}
              <div className="border-t border-gray-100 pt-4 text-left space-y-2">
                <button
                  onClick={handleResetDevice}
                  className="w-full py-2.5 px-4 bg-gray-100 border border-gray-200 hover:bg-gray-200/80 text-gray-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                >
                  <Key className="w-4.5 h-4.5" /> Réinitialiser verrous mobile
                </button>
                <button
                  onClick={() => handleDeleteUser(selectedUser.id, selectedUser.username, selectedUser.displayName)}
                  className="w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-red-100"
                >
                  <Trash2 className="w-4.5 h-4.5" /> Supprimer le profil
                </button>
              </div>
            </div>

            {/* Sub-tab views content dashboard */}
            <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
              {/* Detailed view sub tabs bar */}
              <div className="flex border-b border-gray-100 bg-gray-50/50 overflow-x-auto">
                {(selectedUser.role === 'partner'
                  ? [
                      { id: 'info', label: 'Général', icon: Shield },
                      { id: 'promo_codes', label: 'Codes Promo', icon: Award },
                      { id: 'finances_partner', label: 'Finances', icon: Coins },
                      { id: 'logs', label: 'Historique Admin', icon: History }
                    ]
                  : selectedUser.role === 'apporteur'
                  ? [
                      { id: 'info', label: 'Général', icon: Shield },
                      { id: 'autorisation', label: 'Autorisations', icon: ShieldAlert },
                      { id: 'finances_partner', label: 'Finances', icon: Coins },
                      { id: 'logs', label: 'Historique Admin', icon: History }
                    ]
                  : [
                      { id: 'info', label: 'Général', icon: Shield },
                      { id: 'licence', label: 'Licence', icon: Calendar },
                      { id: 'activite', label: 'Activité', icon: Clock },
                      { id: 'pedago', label: 'Pedagogique', icon: Award },
                      { id: 'conso', label: 'Consommation', icon: Database },
                      { id: 'logs', label: 'Historique Admin', icon: History }
                    ]
                ).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id as any)}
                    className={cn(
                      "px-5 py-3 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-b-2 whitespace-nowrap transition-all",
                      detailTab === tab.id 
                        ? "border-blue-600 text-blue-600 bg-white" 
                        : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50/50"
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tabs detail components */}
              <div className="p-6 flex-1">
                {loadingDetails ? (
                  <div className="flex flex-col items-center justify-center h-full py-20 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    <p className="text-xs text-gray-400 font-bold">Chargement des données de l'abonné...</p>
                  </div>
                ) : (
                  <div>
                    {/* 1. INFORMATIONS GENERALES */}
                    {detailTab === 'info' && (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                          <h4 className="text-base font-extrabold text-indigo-950">Informations Générales</h4>
                          {!isEditingInfo && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => setIsEditingInfo(true)}
                                className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-all border border-blue-100"
                              >
                                <Edit3 className="w-3.5 h-3.5" /> Modifier les informations
                              </button>
                              {selectedUser.role === 'student' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditForm({
                                      role: 'partner',
                                      displayName: selectedUser.displayName || '',
                                      phone: selectedUser.phone || '',
                                      filiere: 'PARTENAIRE',
                                      niveau: 'N/A',
                                      email: selectedUser.email || `${selectedUser.username}@example.com`,
                                      promoCode: (selectedUser.username || '').toUpperCase(),
                                      partnerId: '',
                                      allowedFilieres: [selectedUser.filiere || 'ECN'],
                                      allowedLicences: [selectedUser.filiere || 'ECN'],
                                      statsScope: 'all_partner_licences',
                                      hasAdminAccess: false,
                                      permissions: ['view_users', 'view_stats']
                                    });
                                    setIsEditingInfo(true);
                                  }}
                                  className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-all border border-emerald-100"
                                >
                                  <UserCheck className="w-3.5 h-3.5" /> Promouvoir en partenaire
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {isEditingInfo ? (
                          <form onSubmit={handleSaveInfo} className="space-y-4 max-w-md animate-in fade-in">
                            <div className="space-y-1">
                              <label className="text-xs font-black text-indigo-950">Rôle de l'utilisateur</label>
                              <select
                                value={editForm.role}
                                onChange={(e) => {
                                  const newRole = e.target.value as any;
                                  setEditForm({ 
                                    ...editForm, 
                                    role: newRole,
                                    ...((newRole === 'partner' || newRole === 'apporteur') ? {
                                      filiere: 'PARTENAIRE',
                                      niveau: 'N/A',
                                      email: editForm.email || `${selectedUser?.username}@example.com`,
                                      promoCode: editForm.promoCode || (selectedUser?.username || '').toUpperCase(),
                                      statsScope: editForm.statsScope || 'all_partner_licences',
                                      permissions: editForm.permissions?.length ? editForm.permissions : ['view_users', 'view_stats']
                                    } : {})
                                  });
                                }}
                                className="w-full px-4 py-2 text-sm border-2 border-indigo-150 text-indigo-950 font-black rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                              >
                                <option value="student">Étudiant (Student)</option>
                                <option value="partner">Partenaire (Partner)</option>
                                <option value="apporteur">Apporteur d'Affaires</option>
                                <option value="admin">Super Admin (Administrateur)</option>
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-bold text-gray-500">Nom complet / Nom d'affichage</label>
                              <input
                                type="text"
                                required
                                value={editForm.displayName}
                                onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                                className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-gray-500">Téléphone</label>
                              <input
                                type="text"
                                value={editForm.phone}
                                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                placeholder="Non renseigné"
                                className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>

                            {editForm.role === 'partner' || editForm.role === 'apporteur' ? (
                              <>
                                <div className="space-y-1">
                                  <label className="text-xs font-bold text-gray-500">Email de contact</label>
                                  <input
                                    type="email"
                                    required
                                    value={editForm.email}
                                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value.toLowerCase().trim() })}
                                    className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs font-bold text-gray-500">Code Promo Associé</label>
                                  <input
                                    type="text"
                                    required
                                    value={editForm.promoCode}
                                    onChange={(e) => setEditForm({ ...editForm, promoCode: e.target.value.toLowerCase().trim() })}
                                    className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                  />
                                </div>

                                {/* CONFIGURATION PARTENAIRE EDIT */}
                                {editForm.role === 'partner' && (
                                  <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-4 col-span-2 animate-in fade-in">
                                    <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider mb-2">Paramétrage du Profil Partenaire (Modification)</h4>

                                    {/* 1. Filières autorisées */}
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-black text-gray-700">Filières autorisées (Multi-sélection)</label>
                                      <p className="text-[10px] text-gray-400 mt-0.5">Le partenaire ne pourra voir que les utilisateurs de ces filières</p>
                                      <div className="grid grid-cols-2 gap-2 pt-1">
                                        {activeFilieres.map(f => {
                                          const checked = editForm.allowedFilieres?.includes(f.id);
                                          return (
                                            <label key={f.id} className="flex items-center gap-2 p-2 bg-white rounded-xl border border-gray-100 cursor-pointer text-xs font-semibold text-gray-700 hover:bg-gray-100/50">
                                              <input 
                                                type="checkbox"
                                                className="rounded text-indigo-600 focus:ring-indigo-500"
                                                checked={checked}
                                                onChange={() => {
                                                  const current = editForm.allowedFilieres || [];
                                                  const next = current.includes(f.id) 
                                                    ? current.filter(x => x !== f.id)
                                                    : [...current, f.id];
                                                  setEditForm({ ...editForm, allowedFilieres: next });
                                                }}
                                              />
                                              {f.name}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    {/* 2. Licences visibles */}
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-black text-gray-700">Licences visibles (Multi-sélection)</label>
                                      <p className="text-[10px] text-gray-400 mt-0.5">Le partenaire ne verra que les statistiques de ces licences</p>
                                      <div className="grid grid-cols-2 gap-2 pt-1">
                                        {activeFilieres.map(f => {
                                          const checked = editForm.allowedLicences?.includes(f.id);
                                          return (
                                            <label key={f.id} className="flex items-center gap-2 p-2 bg-white rounded-xl border border-gray-100 cursor-pointer text-xs font-semibold text-gray-700 hover:bg-gray-100/50">
                                              <input 
                                                type="checkbox"
                                                className="rounded text-indigo-600 focus:ring-indigo-500"
                                                checked={checked}
                                                onChange={() => {
                                                  const current = editForm.allowedLicences || [];
                                                  const next = current.includes(f.id) 
                                                    ? current.filter(x => x !== f.id)
                                                    : [...current, f.id];
                                                  setEditForm({ ...editForm, allowedLicences: next });
                                                }}
                                              />
                                              {f.name}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    {/* 3. Portée des statistiques */}
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-black text-gray-700">Portée des statistiques & Utilisateurs</label>
                                      <select
                                        value={editForm.statsScope || 'all_partner_licences'}
                                        onChange={(e) => setEditForm({ ...editForm, statsScope: e.target.value as any })}
                                        className="w-full px-3 py-2 text-xs bg-white border border-gray-200 rounded-xl"
                                      >
                                        <option value="promo_only">Mode 1 : Utilisateurs issus de mon code promo uniquement</option>
                                        <option value="all_partner_licences">Mode 2 : Tous les utilisateurs des licences de parrainage</option>
                                      </select>
                                    </div>

                                    {/* 4. Accès Administration */}
                                    <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-100">
                                      <div>
                                        <p className="text-xs font-black text-gray-800">Accès à l'administration déléguée</p>
                                        <p className="text-[10.5px] text-gray-400">Permet au partenaire de voir un espace admin restreint pour ses licences</p>
                                      </div>
                                      <input 
                                        type="checkbox" 
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                        checked={editForm.hasAdminAccess || false}
                                        onChange={(e) => setEditForm({ ...editForm, hasAdminAccess: e.target.checked })}
                                      />
                                    </div>

                                    {/* 4. Permission list */}
                                    {editForm.hasAdminAccess && (
                                      <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 space-y-2 animate-in slide-in-from-top-2">
                                        <label className="text-xs font-black text-indigo-950 block">Droits administrateur accordés :</label>
                                        <div className="grid grid-cols-1 gap-1.5 pt-1">
                                          {[
                                            { id: 'view_users', label: 'Voir utilisateurs' },
                                            { id: 'view_stats', label: 'Voir statistiques' },
                                            { id: 'view_finances', label: 'Voir finances' },
                                            { id: 'manage_users', label: 'Gérer utilisateurs (Créer, Editer, Renouveler)' },
                                            { id: 'manage_content', label: 'Gérer contenu (Série Q, Chapitres, Blocs...' },
                                            { id: 'create_exams', label: 'Créer examens blancs' },
                                            { id: 'local_admin', label: 'Administration locale' }
                                          ].map(p => {
                                            const checked = editForm.permissions?.includes(p.id);
                                            return (
                                              <label key={p.id} className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
                                                <input 
                                                  type="checkbox"
                                                  className="rounded text-indigo-600 focus:ring-indigo-500"
                                                  checked={checked}
                                                  onChange={() => {
                                                    const current = editForm.permissions || [];
                                                    const next = current.includes(p.id) 
                                                      ? current.filter(x => x !== p.id)
                                                      : [...current, p.id];
                                                    setEditForm({ ...editForm, permissions: next });
                                                  }}
                                                />
                                                {p.label}
                                              </label>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="space-y-1">
                                  <label className="text-xs font-bold text-gray-500">Filière</label>
                                  <select
                                    value={editForm.filiere}
                                    onChange={(e) => setEditForm({ ...editForm, filiere: e.target.value, niveau: 'ALL' })}
                                    className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                  >
                                    {filiereOptions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs font-bold text-gray-500">Niveau</label>
                                  <select
                                    value={editForm.niveau}
                                    onChange={(e) => setEditForm({ ...editForm, niveau: e.target.value })}
                                    className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                  >
                                    {getDynamicLevelsForFiliere(editForm.filiere).map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1 animate-in fade-in">
                                  <label className="text-xs font-bold text-gray-500">Code Promotionnel</label>
                                  <input
                                    type="text"
                                    value={editForm.promoCode || ''}
                                    onChange={(e) => setEditForm({ ...editForm, promoCode: e.target.value })}
                                    placeholder="Ex: RATTACHEMENT (Optionnel)"
                                    className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none uppercase font-mono tracking-wider"
                                  />
                                </div>
                                <div className="space-y-1 animate-in fade-in">
                                  <label className="text-xs font-bold text-gray-500">Partenaire Rattaché (Manuel)</label>
                                  <select
                                    value={editForm.partnerId}
                                    onChange={(e) => setEditForm({ ...editForm, partnerId: e.target.value })}
                                    className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                  >
                                    <option value="">Aucun partenaire rattaché</option>
                                    {users.filter(u => u.role === 'partner').map(p => (
                                      <option key={p.id} value={p.id}>
                                        {p.displayName || p.username} ({p.promoCode?.toUpperCase()})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </>
                            )}

                            {/* Licence setup visible for all roles on edit */}
                            <div className="p-3.5 bg-indigo-50/50 hover:bg-indigo-55/70 rounded-2xl border border-indigo-100 space-y-3 mt-3 animate-in fade-in">
                              <p className="text-[11px] font-black text-indigo-950 uppercase tracking-wider flex items-center gap-1.5 leading-none">
                                <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Paramétrage de la Licence d'Accès
                              </p>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 block leading-none mb-0.5">Durée d'accès de la licence</label>
                                <select
                                  value={editForm.licenseType}
                                  onChange={(e) => {
                                    const type = e.target.value as 'unlimited' | 'limited';
                                    setEditForm({
                                      ...editForm,
                                      licenseType: type,
                                      licenseExpiryDate: type === 'limited' ? (editForm.licenseExpiryDate || new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0]) : ''
                                    });
                                  }}
                                  className="w-full px-3 py-2 text-xs bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold outline-none"
                                >
                                  <option value="unlimited">Licence Illimitée (Accès à vie)</option>
                                  <option value="limited">Date d'expiration personnalisée</option>
                                </select>
                              </div>

                              {editForm.licenseType === 'limited' && (
                                <div className="space-y-1 animate-in slide-in-from-top-1 duration-150">
                                  <label className="text-[10px] font-bold text-gray-500 block leading-none mb-0.5">Expiration de licence</label>
                                  <input
                                    type="date"
                                    required
                                    value={editForm.licenseExpiryDate || ''}
                                    onChange={(e) => setEditForm({ ...editForm, licenseExpiryDate: e.target.value })}
                                    className="w-full px-3 py-2 text-xs bg-white border border-gray-200 text-gray-700 rounded-xl font-bold outline-none font-mono"
                                  />
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                              <button
                                type="submit"
                                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-md"
                              >
                                Enregistrer
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsEditingInfo(false)}
                                className="px-4 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200"
                              >
                                Annuler
                              </button>
                            </div>
                          </form>
                        ) : selectedUser.role === 'partner' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 font-mono">Identifiant Unique</p>
                                <p className="text-sm font-semibold text-gray-900 bg-gray-50 p-2.5 rounded-lg border border-gray-100 font-mono select-all">
                                  {selectedUser.id}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Nom du Partenaire</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg">
                                  {selectedUser.displayName}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Mot d'accès initial</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg font-mono tracking-wider select-all">
                                  {selectedUser.password || <span className="text-gray-300 italic">Protégé</span>}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Numéro de Téléphone</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg">
                                  {selectedUser.phone ? selectedUser.phone : <span className="text-gray-300 italic font-medium">Non spécifié</span>}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Email de Contact</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg font-mono select-all">
                                  {selectedUser.email || <span className="text-gray-300 italic">Non spécifié</span>}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Code Promo Rattaché</p>
                                <p className="text-sm font-extrabold text-blue-700 p-2.5 bg-blue-50 border border-blue-100 rounded-lg font-mono tracking-widest uppercase select-all">
                                  {selectedUser.promoCode}
                                </p>
                              </div>

                              {/* CUSTOM CONFIG DETAILS DISPLAY */}
                              <div className="col-span-1 md:col-span-2 p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-3">
                                <h5 className="text-[11px] font-black text-indigo-900 uppercase tracking-wider">Paramétrage du Profil & Droits d'Accès</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                  <div>
                                    <p className="font-bold text-gray-500">Filières autorisées :</p>
                                    <p className="font-semibold text-gray-800 mt-1">
                                      {selectedUser.allowedFilieres && selectedUser.allowedFilieres.length > 0
                                        ? selectedUser.allowedFilieres.map(id => activeFilieres.find(x => x.id === id)?.name || id).join(', ')
                                        : 'Toutes (Par défaut)'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-500">Licences visibles :</p>
                                    <p className="font-semibold text-gray-800 mt-1">
                                      {selectedUser.allowedLicences && selectedUser.allowedLicences.length > 0
                                        ? selectedUser.allowedLicences.map(id => activeFilieres.find(x => x.id === id)?.name || id).join(', ')
                                        : 'Toutes (Par défaut)'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-500">Portée des statistiques :</p>
                                    <p className="font-semibold text-indigo-950 mt-1">
                                      {selectedUser.statsScope === 'promo_only' 
                                        ? 'Mode 1 : Candidats de mon code promo uniquement' 
                                        : 'Mode 2 : Tous les inscrits des licences de parrainage'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-500">Droits administratifs restreints :</p>
                                    <p className="font-semibold text-gray-800 mt-1">
                                      {selectedUser.hasAdminAccess 
                                        ? `Oui, permissions accordées: [${selectedUser.permissions?.join(', ') || 'aucun droit'}]` 
                                        : 'Non (Abonné Lecture Seule)'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 font-mono">Identifiant Unique</p>
                                <p className="text-sm font-semibold text-gray-900 bg-gray-50 p-2.5 rounded-lg border border-gray-100 font-mono select-all">
                                  {selectedUser.id}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Nom d'affichage</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg">
                                  {selectedUser.displayName}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Mot d'accès initial</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg font-mono tracking-wider select-all">
                                  {selectedUser.password || <span className="text-gray-300 italic">Protégé</span>}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Numéro de Téléphone</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg">
                                  {selectedUser.phone ? selectedUser.phone : <span className="text-gray-300 italic font-medium">Non spécifié</span>}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Filière / Niveau</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg">
                                  {selectedUser.filiere} ({selectedUser.niveau || 'N/A'})
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Statut d'Accès</p>
                                <p className="text-sm font-bold text-gray-800 p-2.5 bg-gray-50 border border-gray-100 rounded-lg">
                                  {getStatusLabelText(selectedUser)}
                                </p>
                              </div>
                              {selectedUser.role === 'student' && (
                                <div className="col-span-1 md:col-span-2">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Partenaire Rattaché</p>
                                  <div className="text-sm font-bold text-indigo-950 p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-lg">
                                    {(() => {
                                      const p = users.find(u => u.id === selectedUser.partnerId);
                                      if (p) {
                                        return `${p.displayName || p.username} (${p.promoCode?.toUpperCase()})`;
                                      }
                                      if (selectedUser.promoCode) {
                                        return `Via code promo: ${selectedUser.promoCode.toUpperCase()}`;
                                      }
                                      return <span className="text-gray-400 italic font-medium">Aucun partenaire rattaché</span>;
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        }
                      </div>
                    )}

                    {/* 2. LICENCE & PROLONGATIONS */}
                    {detailTab === 'licence' && (
                      <div className="space-y-6 animate-in fade-in">
                        <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                          <h4 className="text-base font-extrabold text-indigo-950">Gestion de la Licence</h4>
                          <div className="flex items-center gap-2">
                            {!isEditingLicenseDirectly && (
                              <button
                                onClick={() => {
                                  // Pre-fill fields with current user data
                                  const userExpiry = selectedUser.expiresAt;
                                  let initialType: 'unlimited' | 'limited' = 'unlimited';
                                  let initialExpiryString = '';
                                  if (userExpiry) {
                                    initialType = 'limited';
                                    const expDate = userExpiry.toDate ? userExpiry.toDate() : new Date(userExpiry);
                                    try {
                                      initialExpiryString = expDate.toISOString().split('T')[0];
                                    } catch (err) {
                                      initialExpiryString = new Date().toISOString().split('T')[0];
                                    }
                                  }
                                  setDirectLicenseType(initialType);
                                  setDirectLicenseExpiryDate(initialExpiryString);
                                  setIsEditingLicenseDirectly(true);
                                }}
                                className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50/80 hover:bg-indigo-100 transition-all border border-indigo-150 px-3 py-1.5 rounded-lg"
                              >
                                <Edit3 className="w-3.5 h-3.5" /> Modifier la Licence
                              </button>
                            )}
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest",
                              getStatusLabelText(selectedUser) === 'Actif' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                              {getStatusLabelText(selectedUser)}
                            </span>
                          </div>
                        </div>

                        {/* Direct Licence Editor form */}
                        {isEditingLicenseDirectly ? (
                          <form onSubmit={handleSaveLicenseDirectly} className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-4 animate-in fade-in max-w-md">
                            <div className="flex items-center gap-1.5 text-[11px] font-black text-indigo-950 uppercase tracking-wider leading-none">
                              <Calendar className="w-4 h-4 text-indigo-600" /> Modifier la validité de l'accès
                            </div>
                            
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-500 block leading-none mb-0.5">Durée d'accès de la licence</label>
                              <select
                                value={directLicenseType}
                                onChange={(e) => {
                                  const type = e.target.value as 'unlimited' | 'limited';
                                  setDirectLicenseType(type);
                                  if (type === 'limited' && !directLicenseExpiryDate) {
                                    setDirectLicenseExpiryDate(new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0]);
                                  }
                                }}
                                className="w-full px-3 py-2 text-xs bg-white border border-gray-250 text-gray-700 rounded-xl font-semibold outline-none"
                              >
                                <option value="unlimited">Licence Illimitée (Accès à vie)</option>
                                <option value="limited">Date d'expiration personnalisée</option>
                              </select>
                            </div>

                            {directLicenseType === 'limited' && (
                              <div className="space-y-1 animate-in slide-in-from-top-1 duration-150">
                                <label className="text-[10px] font-bold text-gray-500 block leading-none mb-0.5">Expiration de licence</label>
                                <input
                                  type="date"
                                  required
                                  value={directLicenseExpiryDate}
                                  onChange={(e) => setDirectLicenseExpiryDate(e.target.value)}
                                  className="w-full px-3 py-2 text-xs bg-white border border-gray-250 text-gray-700 rounded-xl font-bold outline-none font-mono"
                                />
                              </div>
                            )}

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-4 py-2 text-xs font-bold text-white bg-indigo-650 rounded-xl hover:bg-indigo-700 shadow-md flex items-center gap-1.5 active:scale-95 transition-all"
                              >
                                {isSubmitting ? (
                                  <>
                                    <Loader2 className="w-3 animate-spin" /> Enregistrement...
                                  </>
                                ) : (
                                  'Enregistrer les modifications'
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsEditingLicenseDirectly(false)}
                                className="px-4 py-2 text-xs font-bold text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 active:scale-95 transition-all"
                              >
                                Annuler
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Activation</span>
                                <span className="font-extrabold text-gray-800">
                                  {selectedUser.createdAt ? (
                                    selectedUser.createdAt.toDate ? selectedUser.createdAt.toDate().toLocaleDateString('fr-FR') : new Date(selectedUser.createdAt).toLocaleDateString('fr-FR')
                                  ) : 'Non activée'}
                                </span>
                              </div>
                              
                              <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Expiration</span>
                                <span className="font-extrabold text-gray-800">
                                  {selectedUser.expiresAt ? (
                                    selectedUser.expiresAt.toDate ? selectedUser.expiresAt.toDate().toLocaleDateString('fr-FR') : new Date(selectedUser.expiresAt).toLocaleDateString('fr-FR')
                                  ) : <span className="text-gray-400 font-bold">Illimitée</span>}
                                </span>
                              </div>

                              <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Jours Restants</span>
                                <span className="font-mono font-extrabold text-indigo-650">
                                  {calculateDaysRemaining(selectedUser.expiresAt)}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <p className="text-xs font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-1">
                                <Timer className="w-4 h-4 text-indigo-500" /> Ajouter du temps de Validité
                              </p>
                              <div className="grid grid-cols-4 gap-2.5">
                                {[
                                  { label: '+1 Mois', val: 1 },
                                  { label: '+3 Mois', val: 3 },
                                  { label: '+6 Mois', val: 6 },
                                  { label: '+12 Mois', val: 12 }
                                ].map(item => (
                                  <button
                                    key={item.val}
                                    onClick={() => handleExtendLicense(item.val)}
                                    className="py-2.5 px-3 bg-indigo-650 hover:bg-indigo-700 hover:shadow-md text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all active:scale-95 shadow-sm"
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        )}

                        <div className="pt-4 border-t border-gray-50">
                          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                            <History className="w-4 h-4 text-gray-300" /> Historique Administratif des Licences
                          </p>
                          <div className="space-y-2 max-h-40 overflow-y-auto divide-y divide-gray-50">
                            {selectedUserLogs.filter(l => l.action === 'renew_license' || l.action === 'create_account').length === 0 ? (
                              <p className="text-xs text-gray-400 italic">Aucun renouvellement enregistré.</p>
                            ) : (
                              selectedUserLogs
                                .filter(l => l.action === 'renew_license' || l.action === 'create_account')
                                .map(log => {
                                  const logTime = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
                                  return (
                                    <div key={log.id} className="pt-2 pb-2 text-[11px] flex justify-between items-start text-gray-600">
                                      <div>
                                        <p className="font-semibold text-gray-800">{log.description}</p>
                                        <p className="text-[9px] text-gray-400">Par {log.adminName}</p>
                                      </div>
                                      <span className="text-[10px] font-semibold text-gray-400 whitespace-nowrap">{logTime.toLocaleDateString('fr-FR')}</span>
                                    </div>
                                  )
                                })
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 3. ACTIVITÉ */}
                    {detailTab === 'activite' && (
                      <div className="space-y-6">
                        <h4 className="text-base font-extrabold text-indigo-950 border-b border-gray-50 pb-2">Suivi d'Activité</h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100 flex items-center gap-3">
                            <Clock className="w-8 h-8 text-indigo-500 opacity-60" />
                            <div>
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Dernière Connexion</span>
                              <span className="font-extrabold text-gray-800 text-sm">
                                {selectedUser.lastLogin ? (
                                  selectedUser.lastLogin.toDate ? selectedUser.lastLogin.toDate().toLocaleString('fr-FR') : new Date(selectedUser.lastLogin).toLocaleString('fr-FR')
                                ) : 'Jamais connecté'}
                              </span>
                            </div>
                          </div>

                          <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100 flex items-center gap-3">
                            <ActivityIcon className="w-8 h-8 text-indigo-500 opacity-60" />
                            <div>
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Dernière Activité Pédagogique</span>
                              <span className="font-extrabold text-gray-800 text-sm">
                                {selectedUserProgress?.lastActiveDate ? (
                                  selectedUserProgress.lastActiveDate.toDate ? selectedUserProgress.lastActiveDate.toDate().toLocaleString('fr-FR') : new Date(selectedUserProgress.lastActiveDate).toLocaleString('fr-FR')
                                ) : 'Aucune activité'}
                              </span>
                            </div>
                          </div>

                          <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100 flex items-center gap-3">
                            <Database className="w-8 h-8 text-indigo-500 opacity-60" />
                            <div>
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nombre Total de Connexions</span>
                              <span className="font-extrabold text-gray-800 text-xl">
                                {selectedUser.totalLogins || selectedUserLogs.filter(l => l.action === 'create_account').length || 0}
                              </span>
                            </div>
                          </div>

                          <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100 flex items-center gap-3">
                            <Timer className="w-8 h-8 text-indigo-500 opacity-60" />
                            <div>
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Temps Estimé sur l'Application</span>
                              <span className="font-extrabold text-gray-800 text-sm">
                                {selectedUserProgress?.answeredQuestions 
                                  ? `${Math.round((selectedUserProgress.answeredQuestions * 1.5) + (selectedUser.totalLogins || 1) * 5)} mins`
                                  : 'Estimation indisponible'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-indigo-50 text-indigo-950 p-4 rounded-xl text-xs flex gap-2 border border-indigo-100">
                          <CheckCircle className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                          <p className="leading-relaxed">
                            Ce module d'activité permet d'isoler les comptes qui ont un usage régulier sur smartphone du SMART WORK BOOK ou ceux inactifs.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* 4. STATISTIQUES PEDAGOGIQUES */}
                    {detailTab === 'pedago' && (
                      <div className="space-y-6">
                        <h4 className="text-base font-extrabold text-indigo-950 border-b border-gray-50 pb-2">Statistiques Pédagogiques de l'étudiant</h4>

                        {selectedUserProgress ? (
                          <div className="space-y-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="p-4 bg-gray-50 rounded-xl text-center border border-gray-100">
                                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Questions résolues</span>
                                <span className="text-2xl font-black text-gray-950">{selectedUserProgress.answeredQuestions || 0}</span>
                              </div>
                              <div className="p-4 bg-green-50 rounded-xl text-center border border-green-100">
                                <span className="text-[10px] font-bold text-green-700 uppercase block mb-1">Réponses Correctes</span>
                                <span className="text-2xl font-black text-green-800">{selectedUserProgress.correctAnswers || 0}</span>
                              </div>
                              <div className="p-4 bg-red-50 rounded-xl text-center border border-red-100">
                                <span className="text-[10px] font-bold text-red-700 uppercase block mb-1">Réponses Fausses</span>
                                <span className="text-2xl font-black text-red-800">{selectedUserProgress.incorrectAnswers || 0}</span>
                              </div>
                              <div className="p-4 bg-blue-50 rounded-xl text-center border border-blue-100">
                                <span className="text-[10px] font-bold text-blue-700 uppercase block mb-1">Réussite Globale</span>
                                <span className="text-2xl font-black text-blue-800">
                                  {Number(((selectedUserProgress.accuracy || 0) * 100).toFixed(1))}%
                                </span>
                              </div>
                            </div>

                            {/* Books and Chapters mapping progress charts */}
                            <div className="space-y-4">
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                                <Award className="w-4 h-4 text-indigo-500" /> Progression thématique par Livre
                              </p>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {books.length === 0 ? (
                                  <p className="text-xs text-gray-400 italic">Aucun livre à afficher</p>
                                ) : (
                                  books.map(book => {
                                    const bookProgress = selectedUserProgress.byBook?.[book.id] || { answered: 0, correct: 0 };
                                    const answered = bookProgress.answered || 0;
                                    const correct = bookProgress.correct || 0;
                                    const pct = answered > 0 ? Math.round((correct / answered) * 100) : 0;

                                    return (
                                      <div key={book.id} className="p-4 bg-gray-50 border border-gray-100/80 rounded-xl space-y-2">
                                        <div className="flex justify-between items-center text-xs font-bold text-gray-800">
                                          <span>{book.name}</span>
                                          <span className="text-indigo-600">{pct}% ({correct}/{answered})</span>
                                        </div>
                                        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                          <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${pct}%` }}></div>
                                        </div>
                                      </div>
                                    )
                                  })
                                )}
                              </div>
                            </div>

                            <div className="pt-2 max-h-52 overflow-y-auto space-y-3">
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                                <Timer className="w-4 h-4 text-indigo-500" /> Progression détaillée par Chapitre
                              </p>
                              {chapters.length === 0 ? (
                                <p className="text-xs text-gray-400 italic col-span-full">Aucun chapitre à cartographier</p>
                              ) : (
                                <div className="divide-y divide-gray-100 bg-gray-50 rounded-2xl p-4 border border-gray-100/50 space-y-2 text-xs">
                                  {chapters.map(chapter => {
                                    const chapProgress = selectedUserProgress.byChapter?.[chapter.id] || { answered: 0, correct: 0 };
                                    const ans = chapProgress.answered || 0;
                                    const cor = chapProgress.correct || 0;
                                    const chapPct = ans > 0 ? Math.round((cor / ans) * 100) : 0;
                                    
                                    if (ans === 0) return null; // Only show chap with activity to save visual clutter

                                    return (
                                      <div key={chapter.id} className="pt-2 pb-2 leading-relaxed flex justify-between items-center">
                                        <div className="min-w-0 pr-4">
                                          <p className="font-semibold text-gray-800 truncate">{chapter.title}</p>
                                          <p className="text-[10px] text-gray-400">Livre: {getBookName(chapter.bookId)}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-indigo-600 font-mono">{chapPct}%</span>
                                          <span className="text-gray-400">({cor}/{ans})</span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="py-20 text-center border-2 border-gray-100 border-dashed rounded-xl">
                            <Trophy className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Aucune progression pédagogique encore enregistrée</p>
                            <p className="text-[10.5px] text-gray-450 mt-1 max-w-sm mx-auto">L'abonné doit au préalable se connecter et répondre à quelques QCM ou simulations pour générer ses données pédagogiques.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 5. CONSOMMATION LOGS */}
                    {detailTab === 'conso' && (
                      <div className="space-y-6">
                        <h4 className="text-base font-extrabold text-indigo-950 border-b border-gray-50 pb-2">Suivi R/W et Consommation de la Base de Données</h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6">
                          {/* Aujourd'hui */}
                          <div className="p-5 bg-gradient-to-br from-indigo-50/50 to-blue-50/20 rounded-2xl border border-indigo-100 space-y-4">
                            <h5 className="font-black text-xs text-indigo-950 uppercase tracking-widest flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span> Aujourd'hui
                            </h5>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Lectures (Reads)</span>
                                <p className="text-2xl font-black text-gray-800 mt-1">{(selectedUserConsumption?.readsToday ?? 0).toLocaleString()}</p>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Écritures (Writes)</span>
                                <p className="text-2xl font-black text-gray-800 mt-1">{(selectedUserConsumption?.writesToday ?? 0).toLocaleString()}</p>
                              </div>
                            </div>
                          </div>
                          
                          {/* Ce Mois */}
                          <div className="p-5 bg-gradient-to-br from-purple-50/50 to-indigo-50/20 rounded-2xl border border-purple-100 space-y-4">
                            <h5 className="font-black text-xs text-purple-950 uppercase tracking-widest flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-purple-600"></span> Ce Mois
                            </h5>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Lectures (Reads)</span>
                                <p className="text-2xl font-black text-gray-800 mt-1">{(selectedUserConsumption?.readsMonth ?? 0).toLocaleString()}</p>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Écritures (Writes)</span>
                                <p className="text-2xl font-black text-gray-800 mt-1">{(selectedUserConsumption?.writesMonth ?? 0).toLocaleString()}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="bg-amber-50 p-4 rounded-xl text-xs border border-amber-200 text-amber-950 flex gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Surveillance de Consommation abusive</p>
                            <p className="leading-relaxed mt-1">
                              Ces mesures permettent d'identifier les abonnés qui utilisent des aspirateurs d'API de banque de questions en analysant une quantité de téléchargements (lectures) disproportionnée par jour.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 6. TIMELINE LOG AUDIT */}
                    {detailTab === 'logs' && (
                      <div className="space-y-6">
                        <h4 className="text-base font-extrabold text-indigo-950 border-b border-gray-50 pb-2">Historique d'Administration Abonné</h4>

                        <div className="relative border-l-2 border-gray-150 pl-5 ml-2.5 space-y-6 max-h-96 overflow-y-auto">
                          {selectedUserLogs.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">Aucun log enregistré pour cet utilisateur.</p>
                          ) : (
                            selectedUserLogs.map(log => {
                              const time = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
                              return (
                                <div key={log.id} className="relative text-xs">
                                  {/* Dot */}
                                  <span className="absolute -left-[27px] top-1 w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-500"></span>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-black text-gray-800 capitalize bg-gray-100 border border-gray-250/20 px-2 py-0.5 rounded text-[10px]">
                                        {log.action.replace('_', ' ')}
                                      </span>
                                      <span className="text-gray-400 font-mono text-[10px]">{time.toLocaleString('fr-FR')}</span>
                                    </div>
                                    <p className="mt-1 text-gray-700 leading-relaxed max-w-xl font-medium">{log.description}</p>
                                    <p className="text-[10px] text-gray-400">Opérateur : <span className="font-semibold text-gray-500">{log.adminName}</span></p>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {/* PARTNER PROMO CODES MANAGER */}
                    {detailTab === 'promo_codes' && selectedUser?.role === 'partner' && (
                      <PartnerPromoCodesManager
                        selectedUser={selectedUser}
                        users={users}
                        financialHistory={financialHistory}
                        globalCurrency={globalCurrency}
                        saveAdminLog={saveAdminLog}
                      />
                    )}

                    {/* PARTNER FINANCES TAB DETAILED */}
                    {detailTab === 'finances_partner' && (selectedUser?.role === 'partner' || selectedUser?.role === 'apporteur') && (
                      <PartnerFinancesTab
                        selectedUser={selectedUser}
                        users={users}
                        financialHistory={financialHistory}
                        globalCurrency={globalCurrency}
                      />
                    )}

                    {/* APPORTEUR AUTORISATIONS TAB */}
                    {detailTab === 'autorisation' && selectedUser?.role === 'apporteur' && (
                      <ApporteurAutorisationTab
                        selectedUser={selectedUser}
                        activeFilieres={activeFilieres}
                        setSelectedUser={setSelectedUser}
                        saveAdminLog={saveAdminLog}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Creation User Modal Sheet Dialog */}
      <AnimatePresence>
        {isAddingUser && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingUser(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 pb-3 border-b border-gray-50 flex items-center justify-between flex-shrink-0">
                <h3 className="text-xl font-black text-gray-900 flex items-center gap-1.5">
                  <UserPlus className="w-5 h-5 text-indigo-500" /> Nouvel Abonné
                </h3>
                <button onClick={() => setIsAddingUser(false)} className="p-1 px-2.5 text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                  Fermer
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {generatedPassword ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 text-center p-4">
                    <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                      <Key className="w-6 h-6 animate-pulse" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-extrabold text-green-800">Compte créé ! Accès disponible immediatement</p>
                      <p className="text-xs text-gray-400 font-semibold">Communiquez le pseudo choisi et ce mot de passe à l'abonné :</p>
                    </div>
                    
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl select-all select-text cursor-copy">
                      <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 leading-none">Pseudo d'Utilisateur</p>
                      <p className="text-sm font-extrabold text-indigo-950 font-mono mb-2">@{newUser.username.replace(/\s+/g, '')}</p>
                      <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1 leading-none">Code d'accès secret</p>
                      <p className="text-lg font-black text-indigo-800 font-mono tracking-widest select-all leading-tight">{generatedPassword}</p>
                    </div>

                    <p className="text-[10px] text-red-500 font-bold leading-normal">
                      ⚠️ Notez bien le code secret et le pseudo maintenant. Pour des raisons d'anonymisation, le mot de passe ne sera plus récupérable.
                    </p>

                    <button
                      onClick={() => setIsAddingUser(false)}
                      className="w-full py-3 bg-gray-900 border border-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                    >
                      Terminer
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleAddUser} className="space-y-3.5">
                    {newUser.role !== 'partner' && (
                      <>
                        <div className="space-y-1 animate-in fade-in">
                          <label className="text-xs font-bold text-gray-600 ml-1">Filière d'Étude</label>
                          <select
                            value={newUser.filiere}
                            onChange={(e) => setNewUser({ ...newUser, filiere: e.target.value, niveau: 'ALL' })}
                            className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl"
                          >
                            {filiereOptions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1 animate-in fade-in">
                          <label className="text-xs font-bold text-gray-600 ml-1">Niveau d'Étude</label>
                          <select
                            value={newUser.niveau}
                            onChange={(e) => setNewUser({ ...newUser, niveau: e.target.value })}
                            className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl"
                          >
                            {getDynamicLevelsForFiliere(newUser.filiere).map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1 animate-in fade-in">
                          <label className="text-xs font-bold text-gray-600 ml-1">Code Promotionnel (Optionnel)</label>
                          <input
                            type="text"
                            value={newUser.promoCode || ''}
                            onChange={(e) => setNewUser({ ...newUser, promoCode: e.target.value })}
                            placeholder="Ex: RATTACHEMENT (Optionnel)"
                            className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl uppercase font-mono tracking-wider focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-600 ml-1">Identifiant Unique (Pseudo de connexion)</label>
                      <input
                        type="text"
                        required
                        value={newUser.username}
                        onChange={(e) => setNewUser({ ...newUser, username: e.target.value.toLowerCase().trim().replace(/\s+/g, '') })}
                        placeholder="Ex: neeldjofang (sans espaces ni accents)"
                        className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-600 ml-1">Nom Complet</label>
                      <input
                        type="text"
                        required
                        value={newUser.displayName}
                        onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                        placeholder="Ex: Nelle Djofang"
                        className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-600 ml-1">Numéro de Téléphone (Optionnel)</label>
                      <input
                        type="text"
                        value={newUser.phone}
                        onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                        placeholder="Ex: +33 6 xx xx xx"
                        className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    {(newUser.role === 'partner' || newUser.role === 'apporteur') && (
                      <>
                        <div className="space-y-1 animate-in fade-in">
                          <label className="text-xs font-bold text-gray-600 ml-1">Code Promo Associé</label>
                          <input
                            type="text"
                            required
                            value={newUser.promoCode}
                            onChange={(e) => setNewUser({ ...newUser, promoCode: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                            placeholder="Ex: drnelle (génère les rattachements)"
                            className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="space-y-1 animate-in fade-in">
                          <label className="text-xs font-bold text-gray-600 ml-1">E-mail de Contact</label>
                          <input
                            type="email"
                            required
                            value={newUser.email || ''}
                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value.toLowerCase().trim() })}
                            placeholder="Ex: nelle@contact.com"
                            className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        {/* CONFIGURATION PARTENAIRE */}
                        {newUser.role === 'partner' && (
                          <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-4 col-span-2 animate-in fade-in">
                          <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider mb-2">Paramétrage du Profil Partenaire</h4>

                          {/* 1. Filières autorisées */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-black text-gray-700">Filières autorisées (Multi-sélection)</label>
                            <p className="text-[10px] text-gray-400 mt-0.5">Le partenaire ne pourra voir que les utilisateurs de ces filières</p>
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              {activeFilieres.map(f => {
                                const checked = newUser.allowedFilieres?.includes(f.id);
                                return (
                                  <label key={f.id} className="flex items-center gap-2 p-2 bg-white rounded-xl border border-gray-100 cursor-pointer text-xs font-semibold text-gray-700 hover:bg-gray-100/50">
                                    <input 
                                      type="checkbox"
                                      className="rounded text-indigo-600 focus:ring-indigo-500"
                                      checked={checked}
                                      onChange={() => {
                                        const current = newUser.allowedFilieres || [];
                                        const next = current.includes(f.id) 
                                          ? current.filter(x => x !== f.id)
                                          : [...current, f.id];
                                        setNewUser({ ...newUser, allowedFilieres: next });
                                      }}
                                    />
                                    {f.name}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          {/* 2. Licences visibles */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-black text-gray-700">Licences visibles (Multi-sélection)</label>
                            <p className="text-[10px] text-gray-400 mt-0.5">Le partenaire ne verra que les statistiques de ces licences</p>
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              {activeFilieres.map(f => {
                                const checked = newUser.allowedLicences?.includes(f.id);
                                return (
                                  <label key={f.id} className="flex items-center gap-2 p-2 bg-white rounded-xl border border-gray-100 cursor-pointer text-xs font-semibold text-gray-700 hover:bg-gray-100/50">
                                    <input 
                                      type="checkbox"
                                      className="rounded text-indigo-600 focus:ring-indigo-500"
                                      checked={checked}
                                      onChange={() => {
                                        const current = newUser.allowedLicences || [];
                                        const next = current.includes(f.id) 
                                          ? current.filter(x => x !== f.id)
                                          : [...current, f.id];
                                        setNewUser({ ...newUser, allowedLicences: next });
                                      }}
                                    />
                                    {f.name}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          {/* 3. Portée des statistiques */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-black text-gray-700">Portée des statistiques & Utilisateurs</label>
                            <select
                              value={newUser.statsScope || 'all_partner_licences'}
                              onChange={(e) => setNewUser({ ...newUser, statsScope: e.target.value as any })}
                              className="w-full px-3 py-2 text-xs bg-white border border-gray-200 text-gray-700 rounded-xl outline-none"
                            >
                              <option value="promo_only">Mode 1 : Utilisateurs issus de mon code promo uniquement</option>
                              <option value="all_partner_licences">Mode 2 : Tous les utilisateurs des licences dont je suis partenaire</option>
                            </select>
                          </div>

                          {/* 4. Accès Administration */}
                          <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-100">
                            <div>
                              <p className="text-xs font-black text-gray-800">Accès à l'administration déléguée</p>
                              <p className="text-[10.5px] text-gray-400">Permet au partenaire d'accéder à un espace admin restreint pour ses licences</p>
                            </div>
                            <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                              checked={newUser.hasAdminAccess || false}
                              onChange={(e) => setNewUser({ ...newUser, hasAdminAccess: e.target.checked })}
                            />
                          </div>

                          {/* 5. Permission list */}
                          {newUser.hasAdminAccess && (
                            <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 space-y-2 animate-in slide-in-from-top-2">
                              <label className="text-xs font-black text-indigo-950 block">Droits administrateur accordés :</label>
                              <div className="grid grid-cols-1 gap-1.5 pt-1">
                                {[
                                  { id: 'view_users', label: 'Voir utilisateurs' },
                                  { id: 'view_stats', label: 'Voir statistiques' },
                                  { id: 'view_finances', label: 'Voir finances' },
                                  { id: 'manage_users', label: 'Gérer utilisateurs (Créer, Editer, Renouveler)' },
                                  { id: 'manage_content', label: 'Gérer contenu (Série Q, Chapitres, Blocs...' },
                                  { id: 'create_exams', label: 'Créer examens blancs' },
                                  { id: 'local_admin', label: 'Administration locale' }
                                ].map(p => {
                                  const checked = newUser.permissions?.includes(p.id);
                                  return (
                                    <label key={p.id} className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
                                      <input 
                                        type="checkbox"
                                        className="rounded text-indigo-600 focus:ring-indigo-500"
                                        checked={checked}
                                        onChange={() => {
                                          const current = newUser.permissions || [];
                                          const next = current.includes(p.id) 
                                            ? current.filter(x => x !== p.id)
                                            : [...current, p.id];
                                          setNewUser({ ...newUser, permissions: next });
                                        }}
                                      />
                                      {p.label}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-600 ml-1">Rôle d'Accès</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(['student', 'partner', 'apporteur', 'admin'] as const).map(role => (
                          <button
                            key={role}
                            type="button"
                            onClick={() => setNewUser({ ...newUser, role, duration: 'unlimited' })}
                            className={cn(
                              "py-2 px-1 text-[9px] font-black rounded-xl border flex items-center justify-center gap-1 transition-all",
                              newUser.role === role 
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                                : "bg-white border-gray-200 text-gray-500"
                            )}
                          >
                            {role === 'admin' ? <Shield className="w-3.5 h-3.5" /> : (role === 'partner' ? <Briefcase className="w-3.5 h-3.5" /> : (role === 'apporteur' ? <Coins className="w-3.5 h-3.5" /> : <GraduationCap className="w-3.5 h-3.5" />))}
                            {role === 'admin' ? 'Admin' : (role === 'partner' ? 'Partenaire' : (role === 'apporteur' ? 'Apporteur' : 'Étudiant'))}
                          </button>
                        ))}
                      </div>
                    </div>

                    {newUser.role !== 'partner' && (
                      <div className="space-y-1 animate-in fade-in">
                        <label className="text-xs font-bold text-gray-600 ml-1">Licence Initiale</label>
                        <select
                          value={newUser.duration}
                          onChange={(e) => setNewUser({ ...newUser, duration: e.target.value })}
                          className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl"
                        >
                          <option value="unlimited">Licence Illimitée</option>
                          <option value="1">1 mois</option>
                          <option value="3">3 mois</option>
                          <option value="6">6 mois</option>
                          <option value="12">12 mois</option>
                        </select>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsAddingUser(false)}
                        className="px-4 py-2.5 bg-gray-100 text-gray-500 text-xs font-bold rounded-xl hover:bg-gray-200 transition-colors"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Création...
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3.5 h-3.5" />
                            Créer l'abonné
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dynamic Delete User Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-150 animate-in zoom-in-95 duration-200 text-left">
            <div className="flex items-center gap-4 text-red-600 mb-6">
              <div className="p-3 bg-red-50 rounded-2xl">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xl font-black tracking-tight text-gray-950">Suppression Définitive</h3>
                <p className="text-[10px] uppercase font-mono tracking-wider text-red-600 font-bold">Zone de danger</p>
              </div>
            </div>
            
            <p className="text-gray-600 text-xs font-medium mb-8 leading-relaxed">
              Êtes-vous sûr de vouloir supprimer définitivement le compte de l'abonné <span className="font-extrabold text-blue-950">"{userToDelete.displayName}"</span> (@{userToDelete.username}) ?
              <br /><br />
              <span className="text-red-600 font-extrabold uppercase tracking-wide text-[10px] block mb-1">Attention :</span>
              Toutes ses données de révisions, fiches, historiques d'examens et progression pédagogique seront effacées de manière <span className="underline font-bold">irréversible</span>.
            </p>
            
            <div className="flex gap-3">
              <button 
                onClick={() => setUserToDelete(null)}
                className="flex-1 px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-750 text-xs font-bold rounded-xl transition cursor-pointer text-center"
              >
                Annuler
              </button>
              <button 
                onClick={executeDeleteUser}
                disabled={isSubmitting}
                className="flex-1 px-5 py-3.5 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-700 transition cursor-pointer shadow-lg shadow-red-100 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Suppression...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Supprimer le compte
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Reset Device Confirmation Modal */}
      {userToResetDevice && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-150 animate-in zoom-in-95 duration-200 text-left">
            <div className="flex items-center gap-4 text-indigo-600 mb-6">
              <div className="p-3 bg-indigo-50 rounded-2xl">
                <Key className="w-8 h-8" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xl font-black tracking-tight text-gray-950">Réinitialiser les verrous mobile</h3>
                <p className="text-[10px] uppercase font-mono tracking-wider text-indigo-600 font-bold">Action Administrative</p>
              </div>
            </div>
            
            <p className="text-gray-600 text-xs font-medium mb-8 leading-relaxed">
              Confirmez-vous la réinitialisation des verrous d'appareil pour <span className="font-extrabold text-blue-950">"{userToResetDevice.displayName}"</span> (@{userToResetDevice.username}) ?
              <br /><br />
              Ceci l'autorisera à lier son compte à un nouveau smartphone ou à une nouvelle tablette, tout en préservant l'intégralité de ses données pédagogiques.
            </p>
            
            <div className="flex gap-3">
              <button 
                onClick={() => setUserToResetDevice(null)}
                className="flex-1 px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-750 text-xs font-bold rounded-xl transition cursor-pointer text-center"
              >
                Annuler
              </button>
              <button 
                onClick={executeResetDevice}
                disabled={isSubmitting}
                className="flex-1 px-5 py-3.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition cursor-pointer shadow-lg shadow-indigo-100 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Traitement...
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4" />
                    Confirmer la réinitialisation
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline fallback SVG component
function ActivityIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
