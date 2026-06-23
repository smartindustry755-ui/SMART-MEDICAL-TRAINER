import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, setDoc, onSnapshot, query, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import { Coins, Filter, Calendar, TrendingUp, ShieldAlert, Check, Edit3, Save, X, RefreshCw, FileText, User, Globe, ArrowDownRight, PlusCircle, Trash2, Tag, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchLicenseParams, LicenseParams, DEFAULT_LICENSE_PARAMS, CURRENCIES, formatCurrency } from '../lib/finances';

interface UserProfile {
  id: string;
  username: string;
  role: string;
  filiere?: string;
  status?: string;
}

export default function FinancialSettingsView() {
  const [licenseParams, setLicenseParams] = useState<LicenseParams[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allPromoCodes, setAllPromoCodes] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'rates_history' | 'expenses' | 'promo_codes'>('rates_history');

  // Promo code management form & filter states
  const [searchPromo, setSearchPromo] = useState('');
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoPartnerId, setNewPromoPartnerId] = useState('');
  const [isSubmittingPromo, setIsSubmittingPromo] = useState(false);

  // Expense creation form states
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseMotif, setExpenseMotif] = useState<'payement partenaire' | 'payement commission code promo' | 'payement hebergement cloud' | 'autre'>('payement partenaire');
  const [expensePartnerId, setExpensePartnerId] = useState('');
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [selectedPromoIds, setSelectedPromoIds] = useState<string[]>([]);
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAuthorizedBy, setExpenseAuthorizedBy] = useState('Administrateur');
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  const [loading, setLoading] = useState(true);
  const [editingLicenseId, setEditingLicenseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<LicenseParams, 'id' | 'name'>>({
    price3m: 0,
    price6m: 0,
    price12m: 0,
    promoCommission: 0,
    partnerCommission: 0,
    status: 'active'
  });
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchHistory, setSearchHistory] = useState('');
  const [globalCurrency, setGlobalCurrency] = useState('XOF');

  useEffect(() => {
    // 0. Fetch global currency settings
    const unsubGlobalSettings = onSnapshot(doc(db, 'settings', 'financialSettings'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().currency) {
        setGlobalCurrency(docSnap.data().currency);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings/financialSettings');
    });
    // 1. Fetch license parameters from Firestore
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

      setLicenseParams(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'licenseParams');
    });

    // 2. Fetch all users to compute live subscriber counts per licence & live partner stats
    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      const uData: any[] = [];
      const students: UserProfile[] = [];
      snap.forEach((doc) => {
        const u = doc.data();
        const fullUser = { id: doc.id, ...u };
        uData.push(fullUser);
        if (u.role === 'student') {
          students.push({ id: doc.id, username: u.username, role: u.role, filiere: u.filiere, status: u.status });
        }
      });
      setAllUsers(uData);
      setUsers(students);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    // 3. Fetch billing history records
    const qHistory = query(collection(db, 'financialHistory'));
    const unsubHistory = onSnapshot(qHistory, (snap) => {
      const histData: any[] = [];
      snap.forEach((doc) => {
        histData.push({ id: doc.id, ...doc.data() });
      });
      // Sort by date descending
      histData.sort((a, b) => {
        const dateA = a.date?.toDate ? a.date.toDate() : new Date(a.date || 0);
        const dateB = b.date?.toDate ? b.date.toDate() : new Date(b.date || 0);
        return dateB.getTime() - dateA.getTime();
      });
      setHistory(histData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'financialHistory');
    });

    // 4. Fetch all promo codes
    const qPromo = query(collection(db, 'promoCodes'));
    const unsubPromo = onSnapshot(qPromo, (snap) => {
      const promoData: any[] = [];
      snap.forEach((doc) => {
        promoData.push({ id: doc.id, ...doc.data() });
      });
      setAllPromoCodes(promoData);
    }, (error) => {
      console.warn("Error fetching promo codes in FinancialSettingsView", error);
    });

    // 5. Fetch all expenses
    const qExpenses = query(collection(db, 'expenses'));
    const unsubExpenses = onSnapshot(qExpenses, (snap) => {
      const expData: any[] = [];
      snap.forEach((doc) => {
        expData.push({ id: doc.id, ...doc.data() });
      });
      // Sort by date descending
      expData.sort((a, b) => {
        const dateA = a.date?.toDate ? a.date.toDate() : new Date(a.date || 0);
        const dateB = b.date?.toDate ? b.date.toDate() : new Date(b.date || 0);
        return dateB.getTime() - dateA.getTime();
      });
      setExpenses(expData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'expenses');
    });

    return () => {
      unsubGlobalSettings();
      unsubParams();
      unsubUsers();
      unsubHistory();
      unsubPromo();
      unsubExpenses();
    };
  }, []);



  const handleEditClick = (lic: LicenseParams) => {
    setEditingLicenseId(lic.id);
    setEditForm({
      price3m: lic.price3m,
      price6m: lic.price6m,
      price12m: lic.price12m,
      promoCommission: lic.promoCommission,
      partnerCommission: lic.partnerCommission,
      status: lic.status
    });
  };

  const handleSaveClick = async (licId: string, name: string) => {
    try {
      const docRef = doc(db, 'licenseParams', licId);
      await setDoc(docRef, {
        name,
        price3m: Number(editForm.price3m),
        price6m: Number(editForm.price6m),
        price12m: Number(editForm.price12m),
        promoCommission: Number(editForm.promoCommission),
        partnerCommission: Number(editForm.partnerCommission),
        status: editForm.status
      });

      setEditingLicenseId(null);
      setStatusMessage({ type: 'success', text: `Paramètres pour la licence ${name} mis à jour avec succès !` });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (e) {
      console.error(e);
      setStatusMessage({ type: 'error', text: "Erreur lors de la mise à jour des paramètres financiers." });
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseAmount || Number(expenseAmount) <= 0) {
      setStatusMessage({ type: 'error', text: 'Veuillez spécifier un montant valide supérieur à 0 !' });
      return;
    }
    if (!expenseDescription.trim()) {
      setStatusMessage({ type: 'error', text: 'Veuillez spécifier une description pour cette dépense.' });
      return;
    }

    setIsSubmittingExpense(true);
    try {
      if (expenseMotif === 'payement partenaire') {
        if (selectedPartnerIds.length === 0) {
          setStatusMessage({ type: 'error', text: 'Veuillez cocher au moins un partenaire bénéficiaire.' });
          setIsSubmittingExpense(false);
          return;
        }

        const amtValue = Number(expenseAmount);

        // Verify balance for each selected partner
        for (const partnerId of selectedPartnerIds) {
          const partnerObj = allUsers.find(u => u.id === partnerId);
          if (!partnerObj) continue;

          const stats = getPartnerStats(partnerObj);
          if (stats.remainingBalance < amtValue) {
            setStatusMessage({ 
              type: 'error', 
              text: `Versement impossible : le solde de ${partnerObj.displayName || partnerObj.username} (${formatCurrency(stats.remainingBalance, globalCurrency)}) est insuffisant pour verser ${formatCurrency(amtValue, globalCurrency)}.` 
            });
            setIsSubmittingExpense(false);
            return;
          }
        }

        // All selected partners have sufficient balance, let's create an expense for each
        for (const partnerId of selectedPartnerIds) {
          const partnerObj = allUsers.find(u => u.id === partnerId);
          const partnerName = partnerObj ? (partnerObj.displayName || partnerObj.username) : partnerId;
          const dataToSave = {
            amount: amtValue,
            motif: expenseMotif,
            partnerId: partnerId,
            description: `${expenseDescription.trim()} (Paiement pour ${partnerName})`,
            authorizedBy: expenseAuthorizedBy.trim() || 'Administrateur',
            date: new Date(),
            status: 'verified'
          };
          await addDoc(collection(db, 'expenses'), dataToSave);
        }

        setSelectedPartnerIds([]);
      } else if (expenseMotif === 'payemment commission code promo') {
        if (selectedPromoIds.length === 0) {
          setStatusMessage({ type: 'error', text: 'Veuillez cocher au moins un code promo.' });
          setIsSubmittingExpense(false);
          return;
        }

        const amtValue = Number(expenseAmount);

        // Verify balance for each selected promo code
        for (const promoId of selectedPromoIds) {
          const promoObj = unifiedPromoCodes.find(p => p.id === promoId);
          if (!promoObj) continue;

          const stats = getPromoCodeStats(promoObj);
          if (stats.remainingBalance < amtValue) {
            setStatusMessage({ 
              type: 'error', 
              text: `Versement impossible : le solde du code promo ${promoId} (${formatCurrency(stats.remainingBalance, globalCurrency)}) est insuffisant pour verser ${formatCurrency(amtValue, globalCurrency)}.` 
            });
            setIsSubmittingExpense(false);
            return;
          }
        }

        // All selected promo codes have sufficient balance, let's create an expense for each
        for (const promoId of selectedPromoIds) {
          const promoObj = unifiedPromoCodes.find(p => p.id === promoId);
          const partnerId = promoObj ? promoObj.partnerId : '';
          const partnerObj = allUsers.find(u => u.id === partnerId);
          const beneficiaryLabel = partnerObj 
            ? `(Code ${promoId} - ${partnerObj.displayName || partnerObj.username})`
            : `(Code ${promoId})`;

          const dataToSave = {
            amount: amtValue,
            motif: expenseMotif,
            partnerId: partnerId || '',
            promoId: promoId,
            description: `${expenseDescription.trim()} ${beneficiaryLabel}`,
            authorizedBy: expenseAuthorizedBy.trim() || 'Administrateur',
            date: new Date(),
            status: 'verified'
          };
          await addDoc(collection(db, 'expenses'), dataToSave);
        }

        setSelectedPromoIds([]);
      } else {
        const dataToSave = {
          amount: Number(expenseAmount),
          motif: expenseMotif,
          partnerId: '',
          description: expenseDescription.trim(),
          authorizedBy: expenseAuthorizedBy.trim() || 'Administrateur',
          date: new Date(),
          status: 'verified'
        };

        await addDoc(collection(db, 'expenses'), dataToSave);
      }
      
      // Reset form
      setExpenseAmount('');
      setExpenseDescription('');
      setExpenseMotif('payement partenaire');
      
      setStatusMessage({ type: 'success', text: 'Dépense de caisse autorisée et retranchée sur le chiffre d\'affaires avec succès !' });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Erreur lors de l\'enregistrement de la dépense de caisse.' });
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cette dépense de caisse ? Le montant sera réintégré dans le chiffre d\'affaires.')) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'expenses', id));
      setStatusMessage({ type: 'success', text: 'La dépense de caisse a été supprimée avec succès !' });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Erreur lors de la suppression de la dépense.' });
    }
  };

  // Helper calculation functions
  const getSubscribersCount = (licId: string) => {
    return users.filter(u => u.filiere === licId).length;
  };

  const getRevenueGenerated = (licId: string) => {
    const lic = licenseParams.find(l => l.id === licId);
    const unitPrice = lic ? lic.price12m : 0; // Utilisation de la formule 12M comme prix unitaire de référence
    return getSubscribersCount(licId) * unitPrice;
  };

  const cleanPromoString = (s: string) => {
    return (s || '')
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };

  const getPartnerStats = (partner: any) => {
    const students = allUsers.filter(u => u.role === 'student');
    const partnerPromoCode = (partner.promoCode || '').toUpperCase().trim();
    const cleanPartnerPromo = cleanPromoString(partnerPromoCode);

    const secCodes = allPromoCodes
      .filter(p => p.partnerId === partner.id)
      .map(p => p.id.toUpperCase());
    const cleanSecCodes = secCodes.map(code => cleanPromoString(code));

    // Find rattachés for this partner
    const rattachés = students.filter(u => {
      const belongsByPromo = !!(cleanPartnerPromo && u.promoCode && cleanPromoString(u.promoCode) === cleanPartnerPromo) ||
                             (u.promoCode && cleanSecCodes.includes(cleanPromoString(u.promoCode)));

      const allowedFils = partner.allowedFilieres || [];
      const matchesFiliere = allowedFils.length > 0 && u.filiere && allowedFils.some((fId: string) => {
        const uFil = u.filiere?.toLowerCase().trim() || '';
        const fIdLow = fId.toLowerCase().trim();
        return uFil.includes(fIdLow) || fIdLow.includes(uFil);
      });

      const allowedLics = partner.allowedLicences || [];
      const matchesLicence = allowedLics.length > 0 && u.filiere && allowedLics.some((lId: string) => {
        const uFil = u.filiere?.toLowerCase().trim() || '';
        const lIdLow = lId.toLowerCase().trim();
        return uFil.includes(lIdLow) || lIdLow.includes(uFil);
      });

      return belongsByPromo || !!matchesFiliere || !!matchesLicence;
    });

    // Map resolved transactions
    const resolvedTrans = rattachés.map(st => {
      // Determine partner and promo flags
      const allowedFils = partner.allowedFilieres || [];
      const matchesFiliere = allowedFils.length > 0 && st.filiere && allowedFils.some((fId: string) => {
        const uFil = st.filiere?.toLowerCase().trim() || '';
        const fIdLow = fId.toLowerCase().trim();
        return uFil.includes(fIdLow) || fIdLow.includes(uFil);
      });

      const allowedLics = partner.allowedLicences || [];
      const matchesLicence = allowedLics.length > 0 && st.filiere && allowedLics.some((lId: string) => {
        const uFil = st.filiere?.toLowerCase().trim() || '';
        const lIdLow = lId.toLowerCase().trim();
        return uFil.includes(lIdLow) || lIdLow.includes(uFil);
      });

      const isPartnerOfLicence = !!(matchesFiliere || matchesLicence || st.partnerId === partner.id || st.partnerId === partner.username);
      const isPromoUser = !!(cleanPartnerPromo && st.promoCode && cleanPromoString(st.promoCode) === cleanPartnerPromo) ||
                          (st.promoCode && cleanSecCodes.includes(cleanPromoString(st.promoCode)));

      const filId = (st.filiere || 'ECN').toUpperCase().trim();
      const lic = licenseParams.find(p => p.id.toUpperCase().trim() === filId)
                  || { 
                       id: filId, 
                       name: filId, 
                       price3m: 30, price6m: 50, price12m: 80, 
                       promoCommission: 10, partnerCommission: 15, 
                       status: 'active',
                       ...(DEFAULT_LICENSE_PARAMS[filId] || DEFAULT_LICENSE_PARAMS.ALL) 
                     };

      const partnerPct = lic.partnerCommission ?? 15;
      const promoPct = lic.promoCommission ?? 10;

      // Find existing real transaction in history
      const foundReal = history.find(t => {
        const isUserMatch = (t.userId && (t.userId === st.id || t.userId === st.username)) || 
                            (t.username && (t.username === st.id || t.username === st.username));
        return isUserMatch;
      });

      if (foundReal) {
        const realPrice = Number(foundReal.amountPaid) || 0;
        const comPartner = isPartnerOfLicence ? Math.round((realPrice * (partnerPct / 100)) * 100) / 100 : 0;
        const comPromo = isPromoUser ? Math.round((realPrice * (promoPct / 100)) * 100) / 100 : 0;
        return comPartner + comPromo;
      }

      // Virtual transaction
      let approxMonths = 3;
      if (st.expiresAt) {
        const created = st.createdAt?.toDate ? st.createdAt.toDate() : (st.createdAt ? new Date(st.createdAt) : null);
        const expires = st.expiresAt.toDate ? st.expiresAt.toDate() : new Date(st.expiresAt);
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

      const comPartner = isPartnerOfLicence ? Math.round((price * (partnerPct / 100)) * 100) / 100 : 0;
      const comPromo = isPromoUser ? Math.round((price * (promoPct / 100)) * 100) / 100 : 0;

      return comPartner + comPromo;
    });

    // Sum resolved commissions
    const partnerTotal = resolvedTrans.reduce((sum, comm) => sum + comm, 0);

    // Keep unmapped real transactions
    const unmappedRealTrans = history.filter(t => {
      const codeMatch = (cleanPartnerPromo && t.promoCode && cleanPromoString(t.promoCode) === cleanPartnerPromo) ||
                        (t.promoCode && cleanSecCodes.includes(cleanPromoString(t.promoCode)));
      const partnerIdMatch = t.partnerId === partner.id || t.partnerId === partner.username;
      const matchesRattache = rattachés.some(st => st.id === t.userId || st.username === t.userId);
      
      const isAlreadyResolved = rattachés.some(st => {
        const isUserMatch = (t.userId && (t.userId === st.id || t.userId === st.username)) || 
                            (t.username && (t.username === st.id || t.username === st.username));
        return isUserMatch;
      });
      return (codeMatch || partnerIdMatch || matchesRattache) && !isAlreadyResolved;
    });

    const unmappedTotal = unmappedRealTrans.reduce((sum, t) => {
      const isPromoUser = !!((cleanPartnerPromo && t.promoCode && cleanPromoString(t.promoCode) === cleanPartnerPromo) ||
                          (t.promoCode && cleanSecCodes.includes(cleanPromoString(t.promoCode))));
      
      const matchedStudent = allUsers.find(u => u.id === t.userId || u.username === t.userId);
      let isPartnerOfLicence = false;
      if (matchedStudent) {
        const allowedFils = partner.allowedFilieres || [];
        const matchesFiliere = allowedFils.length > 0 && matchedStudent.filiere && allowedFils.some((fId: string) => {
          const uFil = matchedStudent.filiere?.toLowerCase().trim() || '';
          const fIdLow = fId.toLowerCase().trim();
          return uFil.includes(fIdLow) || fIdLow.includes(uFil);
        });

        const allowedLics = partner.allowedLicences || [];
        const matchesLicence = allowedLics.length > 0 && matchedStudent.filiere && allowedLics.some((lId: string) => {
          const uFil = matchedStudent.filiere?.toLowerCase().trim() || '';
          const lIdLow = lId.toLowerCase().trim();
          return uFil.includes(lIdLow) || lIdLow.includes(uFil);
        });
        isPartnerOfLicence = !!(matchesFiliere || matchesLicence || matchedStudent.partnerId === partner.id || matchedStudent.partnerId === partner.username);
      } else {
        isPartnerOfLicence = t.partnerId === partner.id || t.partnerId === partner.username;
      }

      const filId = (t.licenseId || (matchedStudent && matchedStudent.filiere) || 'ECN').toUpperCase().trim();
      const lic = licenseParams.find(p => p.id.toUpperCase().trim() === filId)
                  || { promoCommission: 10, partnerCommission: 15 };
      const partnerPct = lic.partnerCommission ?? 15;
      const promoPct = lic.promoCommission ?? 10;

      const realPrice = Number(t.amountPaid) || 0;
      const comPartner = isPartnerOfLicence ? Math.round((realPrice * (partnerPct / 100)) * 100) / 100 : 0;
      const comPromo = isPromoUser ? Math.round((realPrice * (promoPct / 100)) * 100) / 100 : 0;

      return sum + (comPartner + comPromo);
    }, 0);

    const totalComs = partnerTotal + unmappedTotal;

    // Now calculate payouts/expenses for this partner
    const partnerIdStr = partner.id || partner.username || '';
    const totalPayouts = expenses
      .filter(e => e.partnerId === partnerIdStr)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const remainingBalance = Math.max(0, totalComs - totalPayouts);

    return {
      totalComs,
      totalPayouts,
      remainingBalance
    };
  };

  const calculateAllPartnersTotal = () => {
    const partners = allUsers.filter(u => u.role === 'partner');
    return partners.reduce((sum, p) => sum + getPartnerStats(p).totalComs, 0);
  };

  const unifiedPromoCodes = React.useMemo(() => {
    // 1. Collect all explicit promo codes from allPromoCodes collection
    const codes = [...allPromoCodes];
    
    // 2. Add any partner's primary promo code if not already present
    const partners = allUsers.filter(u => u.role === 'partner');
    partners.forEach(partner => {
      if (partner.promoCode) {
        const cleanPCode = partner.promoCode.toUpperCase().trim();
        const exists = codes.some(c => c.id.toUpperCase().trim() === cleanPCode);
        if (!exists && cleanPCode) {
          codes.push({
            id: cleanPCode,
            partnerId: partner.id,
            status: 'active',
            isPrimary: true
          });
        }
      }
    });

    // 3. Scan all student promo codes from student profiles
    const students = allUsers.filter(u => u.role === 'student');
    students.forEach(student => {
      if (student.promoCode) {
        const cleanStCode = student.promoCode.toUpperCase().trim();
        const exists = codes.some(c => c.id.toUpperCase().trim() === cleanStCode);
        if (!exists && cleanStCode) {
          const matchingPartner = partners.find(p => (p.promoCode && p.promoCode.toUpperCase().trim() === cleanStCode));
          codes.push({
            id: cleanStCode,
            partnerId: matchingPartner ? matchingPartner.id : '',
            status: 'used',
            isPrimary: false
          });
        }
      }
    });

    // 4. Scan all transaction history promo codes
    history.forEach(t => {
      if (t.promoCode) {
        const cleanTxCode = t.promoCode.toUpperCase().trim();
        const exists = codes.some(c => c.id.toUpperCase().trim() === cleanTxCode);
        if (!exists && cleanTxCode) {
          const matchingPartner = partners.find(p => (p.promoCode && p.promoCode.toUpperCase().trim() === cleanTxCode));
          codes.push({
            id: cleanTxCode,
            partnerId: matchingPartner ? matchingPartner.id : '',
            status: 'used',
            isPrimary: false
          });
        }
      }
    });

    return codes;
  }, [allPromoCodes, allUsers, history]);

  const getPromoCodeStats = (promo: any) => {
    const cleanPromo = cleanPromoString(promo.id || '');
    const students = allUsers.filter(u => u.role === 'student');

    // Find students whose promoCode matches cleanPromo
    const rattachés = students.filter(u => u.promoCode && cleanPromoString(u.promoCode) === cleanPromo);

    // Map resolved transactions
    const resolvedPromoComs = rattachés.map(st => {
      const filId = (st.filiere || 'ECN').toUpperCase().trim();
      const lic = licenseParams.find(p => p.id.toUpperCase().trim() === filId)
                  || { 
                       id: filId, 
                       name: filId, 
                       price3m: 30, price6m: 50, price12m: 80, 
                       promoCommission: 10, partnerCommission: 15, 
                       status: 'active',
                       ...(DEFAULT_LICENSE_PARAMS[filId] || DEFAULT_LICENSE_PARAMS.ALL) 
                     };

      const promoPct = lic.promoCommission ?? 10;

      // Find real transaction
      const foundReal = history.find(t => {
        const isUserMatch = (t.userId && (t.userId === st.id || t.userId === st.username)) || 
                            (t.username && (t.username === st.id || t.username === st.username));
        return isUserMatch;
      });

      if (foundReal) {
        const realPrice = Number(foundReal.amountPaid) || 0;
        return Math.round((realPrice * (promoPct / 100)) * 100) / 100;
      }

      // Virtual / default price
      let approxMonths = 3;
      if (st.expiresAt) {
        const created = st.createdAt?.toDate ? st.createdAt.toDate() : (st.createdAt ? new Date(st.createdAt) : null);
        const expires = st.expiresAt.toDate ? st.expiresAt.toDate() : new Date(st.expiresAt);
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

      return Math.round((price * (promoPct / 100)) * 100) / 100;
    });

    const resolvedSum = resolvedPromoComs.reduce((sum, cm) => sum + cm, 0);

    // Filter unmapped real transactions (where the promo code was used, but the student object is not resolved)
    const unmappedReal = history.filter(t => {
      const codeMatch = t.promoCode && cleanPromoString(t.promoCode) === cleanPromo;
      const isAlreadyResolved = rattachés.some(st => {
        const isUserMatch = (t.userId && (t.userId === st.id || t.userId === st.username)) || 
                            (t.username && (t.username === st.id || t.username === st.username));
        return isUserMatch;
      });
      return codeMatch && !isAlreadyResolved;
    });

    const unmappedSum = unmappedReal.reduce((sum, t) => {
      const matchedStudent = allUsers.find(u => u.id === t.userId || u.username === t.userId);
      const filId = (t.licenseId || (matchedStudent && matchedStudent.filiere) || 'ECN').toUpperCase().trim();
      const lic = licenseParams.find(p => p.id.toUpperCase().trim() === filId)
                  || { promoCommission: 10 };
      const promoPct = lic.promoCommission ?? 10;
      const realPrice = Number(t.amountPaid) || 0;
      return sum + (Math.round((realPrice * (promoPct / 100)) * 100) / 100);
    }, 0);

    const totalComs = resolvedSum + unmappedSum;

    // Filter payouts/expenses for this SPECIFIC promo code.
    const totalPayouts = expenses
      .filter(e => e.motif === 'payemment commission code promo' && (e.promoId === promo.id || e.partnerId === promo.id))
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const remainingBalance = Math.max(0, totalComs - totalPayouts);

    return {
      totalComs,
      totalPayouts,
      remainingBalance
    };
  };

  const getPromoCodeDetailedStats = React.useCallback((promoId: string) => {
    const cleanPromo = cleanPromoString(promoId);
    const students = allUsers.filter(u => u.role === 'student');
    const rattachés = students.filter(u => u.promoCode && cleanPromoString(u.promoCode) === cleanPromo);

    // Filter real transactions matching this promo code
    const matchingTransactions = history.filter(t => t.promoCode && cleanPromoString(t.promoCode) === cleanPromo);

    // Sum of amounts paid in the matching transactions
    const totalRevenue = matchingTransactions.reduce((sum, t) => sum + (Number(t.amountPaid) || 0), 0);

    // Get the commission stats
    const commStats = getPromoCodeStats({ id: promoId });

    return {
      activeStudentsCount: rattachés.length,
      transactionsCount: matchingTransactions.length,
      totalRevenue,
      ...commStats
    };
  }, [allUsers, history, licenseParams, expenses]);

  const { totalPromoCA, totalPromoComs, totalPromoRemaining } = React.useMemo(() => {
    let ca = 0;
    let coms = 0;
    let remaining = 0;

    unifiedPromoCodes.forEach(pc => {
      const stats = getPromoCodeDetailedStats(pc.id);
      ca += stats.totalRevenue;
      coms += stats.totalComs;
      remaining += stats.remainingBalance;
    });

    return {
      totalPromoCA: ca,
      totalPromoComs: coms,
      totalPromoRemaining: remaining
    };
  }, [unifiedPromoCodes, getPromoCodeDetailedStats]);

  const filteredPromoCodes = React.useMemo(() => {
    const term = searchPromo.toLowerCase().trim();
    if (!term) return unifiedPromoCodes;
    return unifiedPromoCodes.filter(pc => 
      pc.id.toLowerCase().includes(term) ||
      (pc.partnerId && pc.partnerId.toLowerCase().includes(term))
    );
  }, [unifiedPromoCodes, searchPromo]);

  const isBalanceInsufficient = React.useMemo(() => {
    const amtValue = Number(expenseAmount);
    if (!amtValue || amtValue <= 0) return false;

    if (expenseMotif === 'payement partenaire') {
      if (selectedPartnerIds.length === 0) return false;
      return selectedPartnerIds.some(id => {
        const partnerObj = allUsers.find(u => u.id === id);
        if (!partnerObj) return false;
        const stats = getPartnerStats(partnerObj);
        return stats.remainingBalance < amtValue;
      });
    }

    if (expenseMotif === 'payemment commission code promo') {
      if (selectedPromoIds.length === 0) return false;
      return selectedPromoIds.some(id => {
        const promoObj = unifiedPromoCodes.find(p => p.id === id);
        if (!promoObj) return false;
        const stats = getPromoCodeStats(promoObj);
        return stats.remainingBalance < amtValue;
      });
    }

    return false;
  }, [expenseAmount, expenseMotif, selectedPartnerIds, selectedPromoIds, allUsers, unifiedPromoCodes, expenses]);

  const handleCreatePromoCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedCode = newPromoCode.trim().toUpperCase();
    if (!formattedCode) {
      setStatusMessage({ type: 'error', text: 'Veuillez saisir un code promo valide.' });
      return;
    }

    if (formattedCode.length < 3) {
      setStatusMessage({ type: 'error', text: 'Le code promo doit contenir au moins 3 caractères.' });
      return;
    }

    // Check if it already exists
    const exists = unifiedPromoCodes.some(p => p.id.toUpperCase().trim() === formattedCode);
    if (exists) {
      setStatusMessage({ type: 'error', text: 'Ce code promo existe déjà ou est déjà utilisé.' });
      return;
    }

    setIsSubmittingPromo(true);
    try {
      await setDoc(doc(db, 'promoCodes', formattedCode), {
        partnerId: newPromoPartnerId || '',
        status: 'active',
        createdAt: new Date()
      });
      setNewPromoCode('');
      setNewPromoPartnerId('');
      setStatusMessage({ type: 'success', text: `Code promo "${formattedCode}" créé avec succès !` });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Erreur lors de la création du code promo.' });
    } finally {
      setIsSubmittingPromo(false);
    }
  };

  const handleDeletePromo = async (promoId: string) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer le code promo "${promoId}" ?`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'promoCodes', promoId));
      setStatusMessage({ type: 'success', text: 'Le code promo a été supprimé avec succès !' });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Erreur lors de la suppression du code promo.' });
    }
  };

  const handleQuickPayPromo = (promoId: string, remainingBalance: number) => {
    setExpenseMotif('payemment commission code promo');
    setExpenseAmount(remainingBalance > 0 ? String(remainingBalance) : '');
    setSelectedPromoIds([promoId]);
    setExpenseDescription(`Versement de commission pour code promo : ${promoId}`);
    setActiveSubTab('expenses');
    setStatusMessage({ type: 'success', text: `Sélectionné ${promoId} (${formatCurrency(remainingBalance, globalCurrency)}) pour versement.` });
    setTimeout(() => setStatusMessage(null), 4000);
    // Scroll smoothly
    window.scrollTo({ top: 380, behavior: 'smooth' });
  };

  const filteredHistory = history.filter(h => {
    const term = searchHistory.toLowerCase().trim();
    if (!term) return true;
    return (
      h.username?.toLowerCase().includes(term) ||
      h.promoCode?.toLowerCase().includes(term) ||
      h.licenseId?.toLowerCase().includes(term) ||
      h.status?.toLowerCase().includes(term)
    );
  });

  const handleCurrencyChange = async (newCurrency: string) => {
    try {
      await setDoc(doc(db, 'settings', 'financialSettings'), { currency: newCurrency }, { merge: true });
      setStatusMessage({ type: 'success', text: `Devise mise à jour avec succès (${newCurrency}).` });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'settings/financialSettings');
      setStatusMessage({ type: 'error', text: "Erreur lors du changement de la devise." });
    }
  };

  // Calculations for Expenses
  const totalRawCA = licenseParams.reduce((sum, lic) => sum + getRevenueGenerated(lic.id), 0);
  const totalExpensesAmount = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const netActualRevenue = totalRawCA - totalExpensesAmount;

  const partners = allUsers.filter(u => u.role === 'partner');

  return (
    <div className="space-y-8 animate-in fade-in duration-350">
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Paramètres Financiers</h2>
          <p className="text-sm text-gray-500 mt-1">Gérez la tarification, autorisez les dépenses et suivez la comptabilité globale.</p>
        </div>
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm">
          <Globe className="w-5 h-5 text-indigo-600" />
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Devise Globale</label>
            <select
              value={globalCurrency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
              className="text-sm font-bold text-gray-900 bg-transparent border-none outline-none focus:ring-0 p-0 cursor-pointer"
            >
              {CURRENCIES.map(c => (
                <option key={c.code} value={c.code}>{c.name} ({c.symbol})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className={cn(
          "p-4 rounded-xl border flex items-center gap-3 animate-in slide-in-from-top-2",
          statusMessage.type === 'success' 
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-red-50 border-red-200 text-red-800"
        )}>
          {statusMessage.type === 'success' ? <Check className="w-5 h-5 flex-shrink-0" /> : <ShieldAlert className="w-5 h-5 flex-shrink-0" />}
          <p className="text-sm font-bold">{statusMessage.text}</p>
        </div>
      )}

      {/* Main Consolidated KPI Stats (CA Brut, Expenses, CA Net) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-150 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Chiffre d'Affaires Brut (Ventes)</p>
            <p className="text-3xl font-black text-indigo-900 mt-1">
              {formatCurrency(totalRawCA, globalCurrency)}
            </p>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-150 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sorties de Caisse (Dépenses)</p>
            <p className="text-3xl font-black text-rose-600 mt-1">
              {formatCurrency(totalExpensesAmount, globalCurrency)}
            </p>
          </div>
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <ArrowDownRight className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-150 shadow-sm flex items-center justify-between bg-gradient-to-br from-emerald-50/10 to-emerald-100/10">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Résultat Consolidé (CA Net)</p>
            <p className="text-3xl font-black text-emerald-600 mt-1">
              {formatCurrency(netActualRevenue, globalCurrency)}
            </p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Coins className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Internal Sub-Tabs Navigation */}
      <div className="flex border-b border-gray-200 bg-gray-50/50 p-1.5 rounded-xl gap-2 self-start inline-flex">
        <button
          onClick={() => setActiveSubTab('rates_history')}
          className={cn(
            "px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
            activeSubTab === 'rates_history'
              ? "bg-white text-indigo-600 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          Tarifs & Ventes
        </button>
        <button
          onClick={() => setActiveSubTab('expenses')}
          className={cn(
            "px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5",
            activeSubTab === 'expenses'
              ? "bg-white text-rose-600 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse"></span>
          Dépenses & Sorties
        </button>
        <button
          onClick={() => setActiveSubTab('promo_codes')}
          className={cn(
            "px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5",
            activeSubTab === 'promo_codes'
              ? "bg-white text-emerald-600 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          <Tag className="w-3.5 h-3.5 text-emerald-600" />
          Codes Promo ({unifiedPromoCodes.length})
        </button>
      </div>

      {/* SUB-TAB CONTENTS */}
      {activeSubTab === 'rates_history' && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* LICENSE TABLE */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden">
            <div className="px-6 py-5 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900 tracking-tight">Tableau de configuration des Licences</h3>
                <p className="text-xs text-gray-400 mt-0.5">Configurez les formules de tarification et les taux de rétribution des partenaires</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Nom Licence</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Formule 3M</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Formule 6M</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Formule 12M</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Comm. Code Promo</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Comm. Partenaire</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Abonnés</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Chiffre d'Affaire</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Statut</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {licenseParams.map((lic) => {
                    const isEditing = editingLicenseId === lic.id;
                    return (
                      <tr key={lic.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-extrabold text-gray-900">{lic.name || lic.id}</span>
                          <span className="block text-[10px] font-mono text-gray-400 mt-0.5">{lic.id}</span>
                        </td>
                        
                        {/* PRICES & COMMISSIONS FIELDS */}
                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <input 
                                type="number" 
                                className="w-16 p-1 text-xs border rounded text-center font-bold" 
                                value={editForm.price3m}
                                onChange={(e) => setEditForm({...editForm, price3m: Number(e.target.value)})}
                              />
                              <span className="text-xs text-gray-500">{CURRENCIES.find(c => c.code === globalCurrency)?.symbol || globalCurrency}</span>
                            </div>
                          ) : (
                            <span className="font-semibold text-gray-700">{formatCurrency(lic.price3m, globalCurrency)}</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <input 
                                type="number" 
                                className="w-16 p-1 text-xs border rounded text-center font-bold" 
                                value={editForm.price6m}
                                onChange={(e) => setEditForm({...editForm, price6m: Number(e.target.value)})}
                              />
                              <span className="text-xs text-gray-500">{CURRENCIES.find(c => c.code === globalCurrency)?.symbol || globalCurrency}</span>
                            </div>
                          ) : (
                            <span className="font-semibold text-gray-700">{formatCurrency(lic.price6m, globalCurrency)}</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <input 
                                type="number" 
                                className="w-16 p-1 text-xs border rounded text-center font-bold" 
                                value={editForm.price12m}
                                onChange={(e) => setEditForm({...editForm, price12m: Number(e.target.value)})}
                              />
                              <span className="text-xs text-gray-500">{CURRENCIES.find(c => c.code === globalCurrency)?.symbol || globalCurrency}</span>
                            </div>
                          ) : (
                            <span className="font-semibold text-gray-700">{formatCurrency(lic.price12m, globalCurrency)}</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <input 
                                type="number" 
                                className="w-14 p-1 text-xs border rounded text-center font-bold" 
                                value={editForm.promoCommission}
                                onChange={(e) => setEditForm({...editForm, promoCommission: Number(e.target.value)})}
                              />
                              <span className="text-xs text-gray-500">%</span>
                            </div>
                          ) : (
                            <span className="font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-xs">{lic.promoCommission} %</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <input 
                                type="number" 
                                className="w-14 p-1 text-xs border rounded text-center font-bold" 
                                value={editForm.partnerCommission}
                                onChange={(e) => setEditForm({...editForm, partnerCommission: Number(e.target.value)})}
                              />
                              <span className="text-xs text-gray-500">%</span>
                            </div>
                          ) : (
                            <span className="font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-xs">{lic.partnerCommission} %</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center font-extrabold text-gray-900">
                          {getSubscribersCount(lic.id)}
                        </td>

                        <td className="px-6 py-4 text-center font-extrabold text-emerald-600">
                          {formatCurrency(getRevenueGenerated(lic.id), globalCurrency)}
                        </td>

                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <select 
                              className="p-1 text-xs border rounded font-semibold bg-white"
                              value={editForm.status}
                              onChange={(e) => setEditForm({...editForm, status: e.target.value as 'active' | 'inactive'})}
                            >
                              <option value="active">Actif</option>
                              <option value="inactive">Inactif</option>
                            </select>
                          ) : (
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                              lic.status === 'active' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                            )}>
                              {lic.status === 'active' ? 'Actif' : 'Inactif'}
                            </span>
                          )}
                        </td>

                        {/* ACTION BUUTTONS */}
                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button 
                                onClick={() => handleSaveClick(lic.id, lic.name || lic.id)}
                                className="p-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-colors"
                                title="Sauvegarder"
                              >
                                <Save className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => setEditingLicenseId(null)}
                                className="p-1.5 bg-gray-100 text-gray-500 hover:bg-gray-200 rounded-lg transition-colors"
                                title="Annuler"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={() => handleEditClick(lic)}
                              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors inline-flex"
                              title="Modifier les Tarifs"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* BACKUP ESTIMATION CARDS IN THIS TAB */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50 p-6 rounded-3xl border border-gray-150">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wildest">Total Abonnements Activés</p>
              <p className="text-xl font-black text-gray-900 mt-1">{users.length} abonnés étudiants</p>
              <p className="text-xs text-gray-500 mt-0.5">Inscrits à un abonnement valide du système.</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wildest font-semibold text-emerald-600">Revenus Théoriques Estimés</p>
              <p className="text-xl font-black text-emerald-700 mt-1">
                {formatCurrency(licenseParams.reduce((sum, lic) => sum + getRevenueGenerated(lic.id), 0), globalCurrency)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Calculé sur la formule 12M de référence.</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wildest">Commissions Partenaires Engagées</p>
              <p className="text-xl font-black text-slate-800 mt-1">
                {formatCurrency(calculateAllPartnersTotal(), globalCurrency)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 font-medium">Avoirs cumulés avant sorties partielles.</p>
            </div>
          </div>

          {/* BILLING HISTORY TABLE */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-gray-50 to-white">
              <div>
                <h3 className="text-lg font-black text-gray-900 tracking-tight">Historique financier global (Ventes)</h3>
                <p className="text-xs text-gray-400 mt-0.5">Suivi en temps réel des ventes, rattachées ou non à un réseau de parrainage</p>
              </div>
              <div>
                <input 
                  type="text"
                  placeholder="Rechercher par étudiant, coupon..."
                  className="px-4 py-2 text-xs border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 min-w-[240px] bg-white font-medium shadow-sm text-gray-900"
                  value={searchHistory}
                  onChange={(e) => setSearchHistory(e.target.value)}
                />
              </div>
            </div>

            {loading ? (
              <div className="p-12 flex flex-col items-center justify-center text-gray-400">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                <p className="text-xs font-bold">Chargement des transactions et commissions...</p>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-bold">Aucun enregistrement financier trouvé</p>
                <p className="text-xs mt-1">Les ventes de licences actives et de renouvellements s'afficheront ici.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Abonné</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Licence</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center font-mono">Tarif Payé</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Code Promo Utilisé</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center font-mono">Com. Code Promo</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center font-mono">Com. Partenaire</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center font-mono">Reste SMART WORK BOOK</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {filteredHistory.map((h) => {
                      const date = h.date?.toDate ? h.date.toDate() : new Date(h.date || 0);
                      return (
                        <tr key={h.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 text-xs font-semibold text-gray-500 whitespace-nowrap">
                            {date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-6 py-4 font-extrabold text-gray-900">{h.username || 'Étudiant inconnu'}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="font-extrabold text-indigo-950">{h.licenseId}</span>
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-black text-gray-950">
                            {formatCurrency(h.amountPaid || 0, globalCurrency)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {h.promoCode ? (
                              <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider">
                                {h.promoCode}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs italic">Aucun</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-bold text-indigo-600">
                            {formatCurrency(h.commissionPromo || 0, globalCurrency)}
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-bold text-emerald-600">
                            {formatCurrency(h.commissionPartner || 0, globalCurrency)}
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-black text-slate-800">
                            {formatCurrency(h.amountSmartWorkBook || 0, globalCurrency)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-widest bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
                              {h.status === 'paid' ? 'Payé' : h.status || 'Active'}
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

      {activeSubTab === 'expenses' && (
        /* GESTION DES SORTIES SUB-TAB */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          
          {/* Authorize New Expense Form */}
          <div className="bg-white p-6 rounded-3xl border border-gray-150 shadow-xl self-start h-auto space-y-6">
            <div>
              <h3 className="text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-rose-500" />
                Autoriser une Sortie
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Autorisez de nouvelles dépenses à soustraire du chiffre d'affaires.</p>
            </div>

            <form onSubmit={handleAddExpense} className="space-y-4">
              {/* Amount */}
              <div className="space-y-1">
                <label className="text-xs font-black text-gray-700 block">Montant de la dépense ({globalCurrency})</label>
                <div className="relative">
                  <input
                    type="number"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="Ex: 50000"
                    className="w-full text-sm font-bold p-3 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-rose-500 bg-gray-50/50 text-gray-900"
                    required
                    min="1"
                  />
                  <span className="absolute right-3 top-3 text-xs font-black text-gray-400">
                    {CURRENCIES.find(c => c.code === globalCurrency)?.symbol || globalCurrency}
                  </span>
                </div>
              </div>

              {/* Motif / Type */}
              <div className="space-y-1">
                <label className="text-xs font-black text-gray-700 block">Motif de la dépense</label>
                <select
                  value={expenseMotif}
                  onChange={(e) => {
                    setExpenseMotif(e.target.value as any);
                    setExpensePartnerId(''); // Reset partner selection
                  }}
                  className="w-full text-xs font-bold p-3 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-rose-500 bg-white cursor-pointer"
                  required
                >
                  <option value="payement partenaire">Payement Partenaire</option>
                  <option value="payemment commission code promo">Payement Commission Code Promo</option>
                  <option value="payement hebergement cloud">Payement Hébergement Cloud</option>
                  <option value="autre">Autre Dépense</option>
                </select>
              </div>

              {/* Conditional Partner Selector */}
              {expenseMotif === 'payement partenaire' && (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-200 text-left">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-gray-700 block">
                      Partenaire(s) concerné(s) (Cochez pour sélectionner)
                    </label>
                    {partners.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedPartnerIds.length === partners.length) {
                            setSelectedPartnerIds([]);
                          } else {
                            setSelectedPartnerIds(partners.map(p => p.id));
                          }
                        }}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold uppercase tracking-wider"
                      >
                        {selectedPartnerIds.length === partners.length ? "Tout décocher" : "Tout cocher"}
                      </button>
                    )}
                  </div>

                  {partners.length === 0 ? (
                    <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-xl font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Aucun partenaire enregistré sur la plateforme.
                    </p>
                  ) : (
                    <div className="border border-gray-150 rounded-2xl p-3 bg-gray-50 max-h-52 overflow-y-auto space-y-2.5">
                      {partners.map((p) => {
                        const stats = getPartnerStats(p);
                        const isChecked = selectedPartnerIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className={cn(
                              "flex items-center justify-between p-2 rounded-xl border cursor-pointer transition-all hover:bg-white",
                              isChecked 
                                ? "bg-white border-indigo-200 shadow-sm"
                                : "bg-transparent border-transparent"
                            )}
                          >
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedPartnerIds(prev => prev.filter(id => id !== p.id));
                                  } else {
                                    setSelectedPartnerIds(prev => [...prev, p.id]);
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                              />
                              <div className="text-left">
                                <p className="text-xs font-black text-gray-900 leading-tight">
                                  {p.displayName || p.username}
                                </p>
                                <p className="text-[10px] text-gray-400 font-bold mt-0.5">
                                  {p.promoCode ? `Code: ${p.promoCode}` : 'Sans Code'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[11px] font-black text-emerald-600 font-mono">
                                Solde: {formatCurrency(stats.remainingBalance, globalCurrency)}
                              </p>
                              <p className="text-[9px] text-gray-400 font-medium">
                                Acquis: {formatCurrency(stats.totalComs, globalCurrency)}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {expenseMotif === 'payemment commission code promo' && (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-200 text-left">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-gray-700 block">
                      Code(s) promo concerné(s) (Cochez pour sélectionner)
                    </label>
                    {unifiedPromoCodes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedPromoIds.length === unifiedPromoCodes.length) {
                            setSelectedPromoIds([]);
                          } else {
                            setSelectedPromoIds(unifiedPromoCodes.map(pc => pc.id));
                          }
                        }}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold uppercase tracking-wider"
                      >
                        {selectedPromoIds.length === unifiedPromoCodes.length ? "Tout décocher" : "Tout cocher"}
                      </button>
                    )}
                  </div>

                  {unifiedPromoCodes.length === 0 ? (
                    <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-xl font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Aucun code promo actif sur la plateforme.
                    </p>
                  ) : (
                    <div className="border border-gray-150 rounded-2xl p-3 bg-gray-50 max-h-52 overflow-y-auto space-y-2.5">
                      {unifiedPromoCodes.map((pc) => {
                        const stats = getPromoCodeStats(pc);
                        const isChecked = selectedPromoIds.includes(pc.id);
                        
                        // Find potential associated partner for UI helper text
                        const associatedPartner = allUsers.find(u => u.id === pc.partnerId);
                        const partnerName = associatedPartner ? (associatedPartner.displayName || associatedPartner.username) : null;

                        return (
                          <label
                            key={pc.id}
                            className={cn(
                              "flex items-center justify-between p-2 rounded-xl border cursor-pointer transition-all hover:bg-white",
                              isChecked 
                                ? "bg-white border-indigo-200 shadow-sm"
                                : "bg-transparent border-transparent"
                            )}
                          >
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedPromoIds(prev => prev.filter(id => id !== pc.id));
                                  } else {
                                    setSelectedPromoIds(prev => [...prev, pc.id]);
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                              />
                              <div className="text-left">
                                <p className="text-xs font-black text-indigo-700 leading-tight">
                                  {pc.id}
                                </p>
                                <p className="text-[10px] text-gray-400 font-bold mt-0.5">
                                  {partnerName ? `Parrain: ${partnerName}` : 'Code Général'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[11px] font-black text-emerald-600 font-mono">
                                Solde: {formatCurrency(stats.remainingBalance, globalCurrency)}
                              </p>
                              <p className="text-[9px] text-gray-400 font-medium">
                                Acquis: {formatCurrency(stats.totalComs, globalCurrency)}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-black text-gray-700 block">Description / Notes justificatives</label>
                <textarea
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder="Justifiez la sortie (ex: Hébergement Google Cloud Run Mai 2026, Règlement commission de parrainage Octobre...)"
                  className="w-full text-xs font-medium p-3 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-rose-500 bg-gray-50/50 h-24 text-gray-900"
                  required
                />
              </div>

              {/* Authorized By */}
              <div className="space-y-1">
                <label className="text-xs font-black text-gray-700 block">Autorisé par</label>
                <input
                  type="text"
                  value={expenseAuthorizedBy}
                  onChange={(e) => setExpenseAuthorizedBy(e.target.value)}
                  placeholder="Ex: Administrateur Principal"
                  className="w-full text-xs font-bold p-3 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-rose-500 bg-gray-50/50 text-gray-900"
                  required
                />
              </div>

              {isBalanceInsufficient && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-2xl text-xs font-bold leading-relaxed flex items-center gap-2 animate-in fade-in duration-150 text-left">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Solde insuffisant pour certains bénéficiaires sélectionnés.</span>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  isSubmittingExpense || 
                  isBalanceInsufficient ||
                  (expenseMotif === 'payement partenaire' && selectedPartnerIds.length === 0) || 
                  (expenseMotif === 'payemment commission code promo' && selectedPromoIds.length === 0)
                }
                className="w-full p-3.5 bg-rose-600 font-extrabold text-sm text-white rounded-2xl hover:bg-rose-700 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
              >
                {isSubmittingExpense ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Autorisation en cours...
                  </>
                ) : (
                  <>
                    <Coins className="w-4 h-4" />
                    Valider la Sortie
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Expenses Registered Table */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-150 shadow-xl overflow-hidden self-start">
            <div className="px-6 py-5 border-b border-gray-150 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900 tracking-tight">Registre des Dépenses de Caisse</h3>
                <p className="text-xs text-gray-400 mt-0.5">Historique des sorties décomptabilisées du chiffre d'affaires.</p>
              </div>
              <div className="bg-rose-50 border border-rose-100 text-rose-700 px-3 py-1 rounded-xl text-xs font-black">
                Total Sorties: {expenses.length}
              </div>
            </div>

            {expenses.length === 0 ? (
              <div className="p-16 text-center text-gray-400 bg-white">
                <Coins className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-bold">Aucune dépense de caisse autorisée</p>
                <p className="text-xs mt-1">Saisissez les dépenses de gestion cloud, les paiements de parrainage et autres règlements.</p>
              </div>
            ) : (
              <div className="overflow-x-auto bg-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-150 bg-gray-50/50">
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Motif</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Description</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Bénéficiaire</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Montant</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Auteur</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Statut</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {expenses.map((exp) => {
                      const date = exp.date?.toDate ? exp.date.toDate() : new Date(exp.date || 0);
                      const matchedPartner = partners.find(p => p.id === exp.partnerId);
                      return (
                        <tr key={exp.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 text-xs font-semibold text-gray-500 whitespace-nowrap">
                            {date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider whitespace-nowrap",
                              exp.motif === 'payement hebergement cloud' ? "bg-cyan-50 text-cyan-700 border border-cyan-200" :
                              exp.motif === 'payement partenaire' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                              exp.motif === 'payemment commission code promo' ? "bg-indigo-50 text-indigo-700 border border-indigo-200" :
                              "bg-slate-100 text-slate-700 border border-slate-200"
                            )}>
                              {exp.motif === 'payement hebergement cloud' && 'Hébergement Cloud'}
                              {exp.motif === 'payement partenaire' && 'Paiement Associé'}
                              {exp.motif === 'payemment commission code promo' && 'Com. Code Promo'}
                              {exp.motif === 'autre' && 'Autre Dépense'}
                              {!['payement hebergement cloud', 'payement partenaire', 'payemment commission code promo', 'autre'].includes(exp.motif) && exp.motif}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-700 max-w-[180px] truncate" title={exp.description}>
                            {exp.description}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {exp.partnerId ? (
                              <div className="flex flex-col">
                                <span className="font-extrabold text-gray-900">{matchedPartner?.displayName || matchedPartner?.username || exp.partnerId}</span>
                                <span className="text-[10px] text-gray-400 font-bold">{matchedPartner?.promoCode ? `Code: ${matchedPartner.promoCode}` : 'Partenaire'}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400 text-xs italic">N/A</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-black text-rose-600 whitespace-nowrap">
                            - {formatCurrency(exp.amount || 0, globalCurrency)}
                          </td>
                          <td className="px-6 py-4 text-center whitespace-nowrap">
                            <span className="text-xs font-bold text-gray-600">{exp.authorizedBy || 'Admin'}</span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-50 text-emerald-700 rounded-md border border-emerald-150">
                              Validé
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={() => handleDeleteExpense(exp.id)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors inline-flex"
                              title="Annuler/Supprimer la dépense"
                            >
                              <Trash2 className="w-4 h-4" />
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
        </div>
      )}

      {/* GESTION DES CODES PROMO SUB-TAB */}
      {activeSubTab === 'promo_codes' && (
        <div className="space-y-8 animate-in fade-in duration-200">
          
          {/* Summary Mini-Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Codes Uniques</span>
                <p className="text-xl font-extrabold text-gray-900 mt-1">{unifiedPromoCodes.length}</p>
                <p className="text-[10px] text-gray-400 font-medium">Détectés sur la plateforme</p>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <Tag className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Ventes Générées (CA)</span>
                <p className="text-xl font-extrabold text-slate-800 mt-1">{formatCurrency(totalPromoCA, globalCurrency)}</p>
                <p className="text-[10px] text-emerald-600 font-semibold">Chiffre d'Affaires total</p>
              </div>
              <div className="p-3 bg-sky-50 text-sky-600 rounded-xl">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Total Commissions</span>
                <p className="text-xl font-extrabold text-indigo-600 mt-1">{formatCurrency(totalPromoComs, globalCurrency)}</p>
                <p className="text-[10px] text-gray-400 font-bold">Fonds acquis (€/valeur)</p>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <Coins className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">Reste à Régler (Solde)</span>
                <p className="text-xl font-extrabold text-rose-600 mt-1">{formatCurrency(totalPromoRemaining, globalCurrency)}</p>
                <p className="text-[10px] text-rose-500/80 font-semibold font-bold">Attente de versement</p>
              </div>
              <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                <AlertCircle className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Create Code Form */}
            <div className="bg-white p-6 rounded-3xl border border-gray-150 shadow-xl self-start h-auto space-y-6">
              <div>
                <h3 className="text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                  <PlusCircle className="w-5 h-5 text-emerald-500" />
                  Créer un Code Promo
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Ajoutez un code promo manuel autonome ou affilé à un parrain.</p>
              </div>

              <form onSubmit={handleCreatePromoCode} className="space-y-4">
                {/* Code String */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-700 block">Identifiant du Code Promo</label>
                  <input
                    type="text"
                    value={newPromoCode}
                    onChange={(e) => setNewPromoCode(e.target.value)}
                    placeholder="Ex: MEDECINE20, SUPERDR"
                    className="w-full text-sm font-bold p-3 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 text-gray-900 uppercase placeholder:normal-case"
                    required
                  />
                  <p className="text-[10px] text-gray-400 font-medium">Sera converti automatiquement en lettres majuscules sans accents.</p>
                </div>

                {/* Partner Link */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-700 block">Parrain rattaché (Facultatif)</label>
                  <select
                    value={newPromoPartnerId}
                    onChange={(e) => setNewPromoPartnerId(e.target.value)}
                    className="w-full text-xs font-bold p-3 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
                  >
                    <option value="">Code volant (Sans parrain affilié)...</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName || p.username} ({p.promoCode ? `Principal: ${p.promoCode}` : 'Aucun code principal'})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 font-medium">Utile pour retrancher les commissions du solde d'un associé s'il possède ce code promo additionnel.</p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingPromo || !newPromoCode.trim()}
                  className="w-full p-3.5 bg-emerald-600 font-extrabold text-sm text-white rounded-2xl hover:bg-emerald-700 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                >
                  {isSubmittingPromo ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Création en cours...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="w-4 h-4" />
                      Enregistrer le Code Promo
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* List / Register Table */}
            <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-150 shadow-xl overflow-hidden self-start">
              <div className="px-6 py-5 border-b border-gray-150 bg-gradient-to-r from-gray-50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-gray-900 tracking-tight">Registre des Performances Codes Promo</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Performance financière des codes utilisés et de leurs parrains.</p>
                </div>
                
                {/* Search */}
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                    <Filter className="w-3.5 h-3.5 text-gray-400" />
                  </span>
                  <input
                    type="text"
                    value={searchPromo}
                    onChange={(e) => setSearchPromo(e.target.value)}
                    placeholder="Filtrer par code..."
                    className="pl-9 pr-4 py-1.5 text-xs font-bold text-gray-800 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 w-full sm:w-44"
                  />
                </div>
              </div>

              {filteredPromoCodes.length === 0 ? (
                <div className="p-16 text-center text-gray-400 bg-white">
                  <Tag className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm font-bold">Aucun code promo trouvé</p>
                  <p className="text-xs mt-1">Créez un code ou utilisez-en dans l'application pour le lister.</p>
                </div>
              ) : (
                <div className="overflow-x-auto bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-150 bg-gray-50/50">
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Code</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Type / Affiliation</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Inscrits</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Ventes</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">CA Généré</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Com commissions</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Payé (Sorties)</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Solde dû</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm">
                      {filteredPromoCodes.map((pc) => {
                        const stats = getPromoCodeDetailedStats(pc.id);
                        const associatedPartner = partners.find(p => p.id === pc.partnerId);
                        
                        // Check if from collection or virtual
                        const isInCollection = allPromoCodes.some(ap => ap.id === pc.id);
                        const isPrimary = pc.isPrimary;

                        return (
                          <tr key={pc.id} className="hover:bg-gray-50/50 transition-colors">
                            {/* CODE ID */}
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 font-extrabold text-xs rounded-full border border-emerald-200">
                                <Tag className="w-3 h-3 text-emerald-600" />
                                {pc.id}
                              </span>
                            </td>

                            {/* TYPE / AFFILIATION */}
                            <td className="px-6 py-4 whitespace-nowrap">
                              {associatedPartner ? (
                                <div className="flex flex-col">
                                  <span className="font-extrabold text-gray-900 text-xs text-left">
                                    {associatedPartner.displayName || associatedPartner.username}
                                  </span>
                                  <span className="text-[10px] text-gray-400 font-bold text-left">
                                    {isPrimary ? 'Code Principal Parrain' : 'Code Secondaire Parrain'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-400 font-bold text-xs text-left block">
                                  {isPrimary ? 'Compte Associé' : 'Code Libre / Général'}
                                </span>
                              )}
                            </td>

                            {/* ACTIVE STUDENTS */}
                            <td className="px-6 py-4 text-center whitespace-nowrap">
                              <span className="px-2 py-0.5 text-xs font-extrabold text-slate-700 bg-slate-100 rounded-md">
                                {stats.activeStudentsCount} étu.
                              </span>
                            </td>

                            {/* TRANSACTIONS COUNT */}
                            <td className="px-6 py-4 text-center whitespace-nowrap">
                              <span className="text-xs font-bold text-gray-500">
                                {stats.transactionsCount} ventes
                              </span>
                            </td>

                            {/* CA GENERATED */}
                            <td className="px-6 py-4 text-center font-mono font-bold text-slate-900 whitespace-nowrap">
                              {formatCurrency(stats.totalRevenue, globalCurrency)}
                            </td>

                            {/* COMMISSIONS */}
                            <td className="px-6 py-4 text-center font-mono font-bold text-indigo-600 whitespace-nowrap">
                              {formatCurrency(stats.totalComs, globalCurrency)}
                            </td>

                            {/* PAID OUT */}
                            <td className="px-6 py-4 text-center font-mono font-bold text-rose-600 whitespace-nowrap">
                              {stats.totalPayouts > 0 ? `-${formatCurrency(stats.totalPayouts, globalCurrency)}` : '—'}
                            </td>

                            {/* REMAINING BALANCE */}
                            <td className="px-6 py-4 text-center whitespace-nowrap">
                              {stats.remainingBalance > 0 ? (
                                <span className="inline-flex px-2 py-1 rounded-lg text-rose-700 bg-rose-50 border border-rose-150 font-mono font-black text-xs animate-pulse">
                                  {formatCurrency(stats.remainingBalance, globalCurrency)}
                                </span>
                              ) : (
                                <span className="inline-flex px-2 py-1 rounded-lg text-emerald-700 bg-emerald-50 border border-emerald-150 font-semibold text-xs text-center font-mono">
                                  Soldé
                                </span>
                              )}
                            </td>

                            {/* ACTIONS */}
                            <td className="px-6 py-4 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-2">
                                {/* Payout trigger */}
                                {stats.remainingBalance > 0 && (
                                  <button
                                    onClick={() => handleQuickPayPromo(pc.id, stats.remainingBalance)}
                                    className="px-2.5 py-1 bg-yellow-50 hover:bg-yellow-100 text-[10px] text-yellow-800 font-extrabold uppercase tracking-wider rounded-xl border border-yellow-200 transition-colors shadow-sm cursor-pointer"
                                    title="Dégager le solde de commission"
                                  >
                                    Payer Commission
                                  </button>
                                )}

                                {/* Delete */}
                                {isInCollection ? (
                                  <button
                                    onClick={() => handleDeletePromo(pc.id)}
                                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                                    title="Supprimer la configuration du code"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span 
                                    className="text-[10px] text-gray-300 italic font-semibold cursor-help"
                                    title="Ce code est détecté à la volée car configuré directement sur le profil d'un parrain ou utilisé par un étudiant."
                                  >
                                    Détecté
                                  </span>
                                )}
                              </div>
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
      )}



    </div>
  );
}
