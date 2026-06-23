import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, setDoc, onSnapshot, query, getDocs, updateDoc, writeBatch, addDoc, deleteDoc } from 'firebase/firestore';
import { Plus, Edit3, Check, X, Calendar, RefreshCw, GraduationCap, Clock, Save, BadgeEuro, Settings2, Trash2, Book, BookOpen, PlusCircle, Filter } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency, CURRENCIES } from '../lib/finances';
import { FILIERES } from '../lib/constants';

interface Filiere {
  id: string; // e.g. 'ECN', 'IDE'
  name: string;
  levels: string[];
  status: 'active' | 'inactive';
}

interface LicenseFormat {
  id: string; // e.g. '3m', '6m'
  months: number;
  name: string;
  status: 'active' | 'inactive';
}

interface LicenseParams {
  id: string; // correlates with filiere id, e.g. 'ECN'
  name: string;
  status: 'active' | 'inactive';
  promoCommission: number;
  partnerCommission: number;
  prices?: Record<string, number>; // map of formatId -> price
  price3m: number;
  price6m: number;
  price12m: number;
}

export default function LicenceView() {
  const [activeTab, setActiveTab] = useState<'filieres' | 'formats' | 'chapters'>('filieres');
  const [filieres, setFilieres] = useState<Filiere[]>([]);
  const [formats, setFormats] = useState<LicenseFormat[]>([]);
  const [pricesList, setPricesList] = useState<LicenseParams[]>([]);
  const [globalCurrency, setGlobalCurrency] = useState('XOF');
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Chapters management form & filter states
  const [books, setBooks] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [isSubmittingChapter, setIsSubmittingChapter] = useState(false);
  const [searchChapter, setSearchChapter] = useState('');

  // Form states for Filiere
  const [showFiliereModal, setShowFiliereModal] = useState(false);
  const [editingFiliere, setEditingFiliere] = useState<Filiere | null>(null);
  const [filiereForm, setFiliereForm] = useState<{
    id: string;
    name: string;
    levelsStr: string;
    status: 'active' | 'inactive';
  }>({
    id: '',
    name: '',
    levelsStr: 'ALL, Level 1, Level 2',
    status: 'active',
  });

  // Form states for LicenseFormat
  const [showFormatModal, setShowFormatModal] = useState(false);
  const [editingFormat, setEditingFormat] = useState<LicenseFormat | null>(null);
  const [formatForm, setFormatForm] = useState<{
    id: string;
    name: string;
    months: number;
    status: 'active' | 'inactive';
  }>({
    id: '',
    name: '',
    months: 1,
    status: 'active',
  });

  // Pricing edit states per filiere
  const [editingParamsId, setEditingParamsId] = useState<string | null>(null);
  const [pricingForm, setPricingForm] = useState<{
    promoCommission: number;
    partnerCommission: number;
    prices: Record<string, number>;
  }>({
    promoCommission: 10,
    partnerCommission: 15,
    prices: {},
  });

  // Load overall settings (e.g. Currency)
  useEffect(() => {
    const unsubGlobalSettings = onSnapshot(doc(db, 'settings', 'financialSettings'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().currency) {
        setGlobalCurrency(docSnap.data().currency);
      }
    }, (error) => {
      console.warn("Could not fetch currency settings", error);
    });
    return () => unsubGlobalSettings();
  }, []);

  // Fetch Filieres, Formats and pricing configs dynamically
  useEffect(() => {
    setLoading(true);

    // One-time auto-seeder to ensure user doesn't see a blank page
    const autoSeedIfEmpty = async () => {
      try {
        const filieresSnap = await getDocs(collection(db, 'filieres'));
        const formatsSnap = await getDocs(collection(db, 'licenseFormats'));
        const paramsSnap = await getDocs(collection(db, 'licenseParams'));

        const existingFilieres = filieresSnap.docs.map(d => d.id);
        const existingFormats = formatsSnap.docs.map(d => d.id);
        const existingParams = paramsSnap.docs.map(d => d.id);

        const batch = writeBatch(db);
        let needsCommit = false;

        // 1. Seed filieres
        const defaultFilieres = FILIERES.map(f => ({
          id: f.id,
          name: f.name,
          levels: f.levels,
          status: 'active' as const
        }));

        defaultFilieres.forEach(f => {
          if (!existingFilieres.includes(f.id)) {
            const ref = doc(db, 'filieres', f.id);
            batch.set(ref, {
              name: f.name,
              levels: f.levels,
              status: f.status
            });
            needsCommit = true;
          }
        });

        // 2. Seed license formats
        const defaultFormats = [
          { id: '3m', name: '3 Mois', months: 3, status: 'active' as const },
          { id: '6m', name: '6 Mois', months: 6, status: 'active' as const },
          { id: '12m', name: '12 Mois', months: 12, status: 'active' as const },
          { id: 'unlimited', name: 'Accès Illimité', months: 9999, status: 'active' as const }
        ];

        defaultFormats.forEach(f => {
          if (!existingFormats.includes(f.id)) {
            const ref = doc(db, 'licenseFormats', f.id);
            batch.set(ref, {
              name: f.name,
              months: f.months,
              status: f.status
            });
            needsCommit = true;
          }
        });

        // 3. Seed default pricing parameters (licenseParams)
        defaultFilieres.forEach(f => {
          const pricingRef = doc(db, 'licenseParams', f.id);
          const price3m = f.id === 'EM' ? 35 : f.id === 'IDE' ? 25 : f.id === 'SF' ? 25 : f.id === 'KINE' ? 28 : f.id === 'ALL' ? 20 : 30;
          const price6m = f.id === 'EM' ? 60 : f.id === 'IDE' ? 40 : f.id === 'SF' ? 40 : f.id === 'KINE' ? 45 : f.id === 'ALL' ? 35 : 50;
          const price12m = f.id === 'EM' ? 90 : f.id === 'IDE' ? 70 : f.id === 'SF' ? 70 : f.id === 'KINE' ? 75 : f.id === 'ALL' ? 60 : 80;
          const priceUnlimited = f.id === 'EM' ? 150 : f.id === 'IDE' ? 120 : f.id === 'SF' ? 120 : f.id === 'KINE' ? 130 : f.id === 'ALL' ? 100 : 130;

          if (!existingParams.includes(f.id)) {
            batch.set(pricingRef, {
              name: f.name,
              price3m,
              price6m,
              price12m,
              promoCommission: 10,
              partnerCommission: 15,
              status: 'active',
              prices: {
                '3m': price3m,
                '6m': price6m,
                '12m': price12m,
                'unlimited': priceUnlimited
              }
            });
            needsCommit = true;
          } else {
            const docSnap = paramsSnap.docs.find(d => d.id === f.id);
            if (docSnap) {
              const currentData = docSnap.data();
              const currentPrices = currentData.prices || {};
              let pricesUpdated = false;

              const checkPrices = [
                { key: '3m', val: price3m },
                { key: '6m', val: price6m },
                { key: '12m', val: price12m },
                { key: 'unlimited', val: priceUnlimited }
              ];

              checkPrices.forEach(cp => {
                if (currentPrices[cp.key] === undefined) {
                  currentPrices[cp.key] = cp.val;
                  pricesUpdated = true;
                }
              });

              if (pricesUpdated) {
                batch.update(pricingRef, {
                  prices: currentPrices
                });
                needsCommit = true;
              }
            }
          }
        });

        if (needsCommit) {
          await batch.commit();
          console.log("Seeding verified and completed.");
        }
      } catch (err) {
        console.warn("Autoseed check failure: ", err);
      }
    };

    autoSeedIfEmpty();

    const unsubFilieres = onSnapshot(query(collection(db, 'filieres')), (snap) => {
      const list: Filiere[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Filiere);
      });
      setFilieres(list);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'filieres');
    });

    const unsubFormats = onSnapshot(query(collection(db, 'licenseFormats')), (snap) => {
      const list: LicenseFormat[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as LicenseFormat);
      });
      setFormats(list);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'licenseFormats');
    });

    const unsubParams = onSnapshot(query(collection(db, 'licenseParams')), (snap) => {
      const list: LicenseParams[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as LicenseParams);
      });
      setPricesList(list);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'licenseParams');
      setLoading(false);
    });

    const qBooks = query(collection(db, 'books'));
    const unsubBooks = onSnapshot(qBooks, (snap) => {
      const bData: any[] = [];
      snap.forEach((doc) => {
        bData.push({ id: doc.id, ...doc.data() });
      });
      bData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setBooks(bData);
    }, (error) => {
      console.warn("Error fetching books in LicenceView", error);
    });

    const qChapters = query(collection(db, 'chapters'));
    const unsubChapters = onSnapshot(qChapters, (snap) => {
      const cData: any[] = [];
      snap.forEach((doc) => {
        cData.push({ id: doc.id, ...doc.data() });
      });
      cData.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      setChapters(cData);
    }, (error) => {
      console.warn("Error fetching chapters in LicenceView", error);
    });

    return () => {
      unsubFilieres();
      unsubFormats();
      unsubParams();
      unsubBooks();
      unsubChapters();
    };
  }, []);

  // Automatic bootstrapper to seed database if empty
  const handleBootstrapDefaults = async () => {
    setInitializing(true);
    setStatusMessage(null);
    try {
      const filieresSnap = await getDocs(collection(db, 'filieres'));
      const formatsSnap = await getDocs(collection(db, 'licenseFormats'));
      const paramsSnap = await getDocs(collection(db, 'licenseParams'));

      const existingFilieres = filieresSnap.docs.map(d => d.id);
      const existingFormats = formatsSnap.docs.map(d => d.id);
      const existingParams = paramsSnap.docs.map(d => d.id);

      const batch = writeBatch(db);
      let needsCommit = false;

      // 1. Seed filieres
      const defaultFilieres = FILIERES.map(f => ({
        id: f.id,
        name: f.name,
        levels: f.levels,
        status: 'active' as const
      }));

      defaultFilieres.forEach(f => {
        if (!existingFilieres.includes(f.id)) {
          const ref = doc(db, 'filieres', f.id);
          batch.set(ref, {
            name: f.name,
            levels: f.levels,
            status: f.status
          });
          needsCommit = true;
        }
      });

      // 2. Seed license formats
      const defaultFormats = [
        { id: '3m', name: '3 Mois', months: 3, status: 'active' as const },
        { id: '6m', name: '6 Mois', months: 6, status: 'active' as const },
        { id: '12m', name: '12 Mois', months: 12, status: 'active' as const },
        { id: 'unlimited', name: 'Accès Illimité', months: 9999, status: 'active' as const }
      ];

      defaultFormats.forEach(f => {
        if (!existingFormats.includes(f.id)) {
          const ref = doc(db, 'licenseFormats', f.id);
          batch.set(ref, {
            name: f.name,
            months: f.months,
            status: f.status
          });
          needsCommit = true;
        }
      });

      // 3. Seed default pricing parameters (licenseParams)
      defaultFilieres.forEach(f => {
        const pricingRef = doc(db, 'licenseParams', f.id);
        const price3m = f.id === 'EM' ? 35 : f.id === 'IDE' ? 25 : f.id === 'SF' ? 25 : f.id === 'KINE' ? 28 : f.id === 'ALL' ? 20 : 30;
        const price6m = f.id === 'EM' ? 60 : f.id === 'IDE' ? 40 : f.id === 'SF' ? 40 : f.id === 'KINE' ? 45 : f.id === 'ALL' ? 35 : 50;
        const price12m = f.id === 'EM' ? 90 : f.id === 'IDE' ? 70 : f.id === 'SF' ? 70 : f.id === 'KINE' ? 75 : f.id === 'ALL' ? 60 : 80;
        const priceUnlimited = f.id === 'EM' ? 150 : f.id === 'IDE' ? 120 : f.id === 'SF' ? 120 : f.id === 'KINE' ? 130 : f.id === 'ALL' ? 100 : 130;

        if (!existingParams.includes(f.id)) {
          batch.set(pricingRef, {
            name: f.name,
            price3m,
            price6m,
            price12m,
            promoCommission: 10,
            partnerCommission: 15,
            status: 'active',
            prices: {
              '3m': price3m,
              '6m': price6m,
              '12m': price12m,
              'unlimited': priceUnlimited
            }
          });
          needsCommit = true;
        } else {
          // Check if prices map needs updates
          const docSnap = paramsSnap.docs.find(d => d.id === f.id);
          if (docSnap) {
            const currentData = docSnap.data();
            const currentPrices = currentData.prices || {};
            let pricesUpdated = false;

            const checkPrices = [
              { key: '3m', val: price3m },
              { key: '6m', val: price6m },
              { key: '12m', val: price12m },
              { key: 'unlimited', val: priceUnlimited }
            ];

            checkPrices.forEach(cp => {
              if (currentPrices[cp.key] === undefined) {
                currentPrices[cp.key] = cp.val;
                pricesUpdated = true;
              }
            });

            if (pricesUpdated) {
              batch.update(pricingRef, {
                prices: currentPrices
              });
              needsCommit = true;
            }
          }
        }
      });

      await batch.commit();
      showStatus('success', 'Les données de licence par défaut manquantes ont été initialisées avec succès !');
    } catch (e: any) {
      console.error("Bootstrap error:", e);
      showStatus('error', 'Erreur d\'initialisation : ' + e.message);
    } finally {
      setInitializing(false);
    }
  };

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage(null);
    }, 5000);
  };

  // Filiere handlers
  const handleOpenFiliereModal = (filiere?: Filiere) => {
    if (filiere) {
      setEditingFiliere(filiere);
      setFiliereForm({
        id: filiere.id,
        name: filiere.name,
        levelsStr: filiere.levels.join(', '),
        status: filiere.status
      });
    } else {
      setEditingFiliere(null);
      setFiliereForm({
        id: '',
        name: '',
        levelsStr: 'ALL, D1, D2, D3, D4',
        status: 'active'
      });
    }
    setShowFiliereModal(true);
  };

  const handleSaveFiliere = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filiereForm.id || !filiereForm.name) {
      showStatus('error', 'Veuillez remplir les champs obligatoires.');
      return;
    }

    const trimmedId = filiereForm.id.trim().toUpperCase();
    const parsedLevels = filiereForm.levelsStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    try {
      // Save/Update Filiere
      const filiereRef = doc(db, 'filieres', trimmedId);
      await setDoc(filiereRef, {
        name: filiereForm.name.trim(),
        levels: parsedLevels,
        status: filiereForm.status
      });

      // Maintain associated pricing configurations in 'licenseParams'
      const pricingRef = doc(db, 'licenseParams', trimmedId);
      const paramsSnap = await getDocs(collection(db, 'licenseParams'));
      const matches = paramsSnap.docs.find(d => d.id === trimmedId);

      if (!matches) {
        // Initialize default pricing parameters
        await setDoc(pricingRef, {
          name: filiereForm.name.trim(),
          price3m: 30,
          price6m: 50,
          price12m: 80,
          promoCommission: 10,
          partnerCommission: 15,
          status: 'active',
          prices: {
            '3m': 30,
            '6m': 50,
            '12m': 80
          }
        });
      } else {
        // Just update name/status of license parameters
        await updateDoc(pricingRef, {
          name: filiereForm.name.trim(),
          status: filiereForm.status
        });
      }

      showStatus('success', editingFiliere ? 'Filière mise à jour.' : 'Filière ajoutée.');
      setShowFiliereModal(false);
    } catch (e: any) {
      handleFirestoreError(e, OperationType.WRITE, `filieres/${trimmedId}`);
      showStatus('error', e.message);
    }
  };

  // LicenseFormat handlers
  const handleOpenFormatModal = (fmt?: LicenseFormat) => {
    if (fmt) {
      setEditingFormat(fmt);
      setFormatForm({
        id: fmt.id,
        name: fmt.name,
        months: fmt.months,
        status: fmt.status
      });
    } else {
      setEditingFormat(null);
      setFormatForm({
        id: '',
        name: '',
        months: 1,
        status: 'active'
      });
    }
    setShowFormatModal(true);
  };

  const handleSaveFormat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formatForm.id || !formatForm.name || !formatForm.months) {
      showStatus('error', 'Veuillez remplir les champs obligatoires.');
      return;
    }

    const trimmedId = formatForm.id.trim().toLowerCase();

    try {
      const formatRef = doc(db, 'licenseFormats', trimmedId);
      await setDoc(formatRef, {
        name: formatForm.name.trim(),
        months: Number(formatForm.months),
        status: formatForm.status
      });

      showStatus('success', editingFormat ? 'Format mis à jour.' : 'Format ajouté.');
      setShowFormatModal(false);
    } catch (e: any) {
      handleFirestoreError(e, OperationType.WRITE, `licenseFormats/${trimmedId}`);
      showStatus('error', e.message);
    }
  };

  // Pricing Form Handlers
  const handleEditPricingClick = (lic: LicenseParams) => {
    setEditingParamsId(lic.id);
    
    // Build initial pricing from license document
    const currentPrices: Record<string, number> = {};
    formats.forEach(f => {
      if (lic.prices && lic.prices[f.id] !== undefined) {
        currentPrices[f.id] = lic.prices[f.id];
      } else {
        // Fallback checks
        if (f.months === 3) currentPrices[f.id] = lic.price3m || 0;
        else if (f.months === 6) currentPrices[f.id] = lic.price6m || 0;
        else if (f.months === 12) currentPrices[f.id] = lic.price12m || 0;
        else currentPrices[f.id] = f.months * 10; // estimate
      }
    });

    setPricingForm({
      promoCommission: lic.promoCommission || 10,
      partnerCommission: lic.partnerCommission || 15,
      prices: currentPrices,
    });
  };

  const handleSavePricing = async (licId: string, currentParams: LicenseParams) => {
    try {
      const docRef = doc(db, 'licenseParams', licId);
      
      // Map back to backward-compatible fields
      let price3mValue = currentParams.price3m;
      let price6mValue = currentParams.price6m;
      let price12mValue = currentParams.price12m;

      formats.forEach(f => {
        const price = pricingForm.prices[f.id] || 0;
        if (f.months === 3) price3mValue = price;
        if (f.months === 6) price6mValue = price;
        if (f.months === 12) price12mValue = price;
      });

      await updateDoc(docRef, {
        promoCommission: Number(pricingForm.promoCommission),
        partnerCommission: Number(pricingForm.partnerCommission),
        prices: pricingForm.prices,
        price3m: price3mValue,
        price6m: price6mValue,
        price12m: price12mValue,
      });

      setEditingParamsId(null);
      showStatus('success', 'Tarifs et commissions mis à jour avec succès.');
    } catch (e: any) {
      handleFirestoreError(e, OperationType.WRITE, `licenseParams/${licId}`);
      showStatus('error', e.message);
    }
  };

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChapterTitle.trim()) {
      showStatus('error', 'Veuillez remplir le nom du chapitre.');
      return;
    }
    
    setIsSubmittingChapter(true);
    
    try {
      const cleanTitle = newChapterTitle.trim().toLowerCase();

      // Check for duplicate in local state across all chapters
      const existing = chapters.find(
        c => (c.title || '').toLowerCase() === cleanTitle
      );

      if (existing) {
        showStatus('error', `Le chapitre "${newChapterTitle}" existe déjà.`);
        setIsSubmittingChapter(false);
        return;
      }

      await addDoc(collection(db, 'chapters'), {
        bookId: '',
        title: cleanTitle,
        filiere: 'ECN',
        niveau: 'ALL',
        createdAt: new Date()
      });

      showStatus('success', `Le chapitre "${newChapterTitle}" a été créé avec succès.`);
      setNewChapterTitle('');
    } catch (error: any) {
      console.error("Error creating chapter: ", error);
      showStatus('error', `Erreur lors de la création du chapitre: ${error.message}`);
    } finally {
      setIsSubmittingChapter(false);
    }
  };

  const handleDeleteChapter = async (chapterId: string, chapterTitle: string) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer le chapitre "${chapterTitle}" ?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'chapters', chapterId));
      showStatus('success', `Le chapitre "${chapterTitle}" a été supprimé.`);
    } catch (error: any) {
      console.error("Error deleting chapter: ", error);
      showStatus('error', `Erreur de suppression: ${error.message}`);
    }
  };

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-3xl border border-gray-100 p-6 shadow-xl shadow-blue-900/5 space-y-6">
      
      {/* Sub-Header & Action Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
        
        {/* Tab Selection */}
        <div className="flex bg-gray-100 p-1 rounded-2xl w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('filieres')}
            className={cn(
              "flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2",
              activeTab === 'filieres'
                ? "bg-white text-blue-600 shadow-md"
                : "text-gray-500 hover:text-gray-800"
            )}
          >
            <GraduationCap className="w-4 h-4" />
            Filières
          </button>
          <button
            onClick={() => setActiveTab('formats')}
            className={cn(
              "flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2",
              activeTab === 'formats'
                ? "bg-white text-blue-600 shadow-md"
                : "text-gray-500 hover:text-gray-800"
            )}
          >
            <Clock className="w-4 h-4" />
            Formats & Prix
          </button>
          <button
            onClick={() => setActiveTab('chapters')}
            className={cn(
              "flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2",
              activeTab === 'chapters'
                ? "bg-white text-blue-600 shadow-md"
                : "text-gray-500 hover:text-gray-800"
            )}
          >
            <Book className="w-4 h-4" />
            Chapitres ({chapters.length})
          </button>
        </div>

        {/* Global Action Buttons */}
        <div className="flex gap-2 w-full sm:w-auto justify-end">
          {filieres.length === 0 && (
            <button
              onClick={handleBootstrapDefaults}
              disabled={initializing}
              className="px-4 py-2.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-2xl text-xs font-bold transition-all flex items-center gap-2"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", initializing && "animate-spin")} />
              Données par Défaut
            </button>
          )}

          {activeTab === 'filieres' ? (
            <button
              onClick={() => handleOpenFiliereModal()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold transition-all shadow-md shadow-blue-100 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nouvelle Filière
            </button>
          ) : activeTab === 'formats' ? (
            <button
              onClick={() => handleOpenFormatModal()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold transition-all shadow-md shadow-blue-100 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nouveau Format
            </button>
          ) : null}
        </div>
      </div>

      {/* Success/Error status feedback */}
      {statusMessage && (
        <div className={cn(
          "p-4 rounded-2xl border text-sm flex items-center justify-between gap-3 animate-in fade-in duration-300",
          statusMessage.type === 'success' 
            ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
            : "bg-red-50 text-red-800 border-red-100"
        )}>
          <span>{statusMessage.text}</span>
          <button onClick={() => setStatusMessage(null)} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-sm font-bold text-gray-500">Chargement de la configuration des licences...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: FILIERES LISTING */}
          {activeTab === 'filieres' && (
            <div className="space-y-4">
              {filieres.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-200 rounded-3xl p-6">
                  <GraduationCap className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <h3 className="font-bold text-gray-700">Aucune filière trouvée</h3>
                  <p className="text-xs text-gray-500 mt-1 mb-4">Initialisez les filières par défaut ou ajoutez-en une manuellement.</p>
                  <button
                    onClick={handleBootstrapDefaults}
                    className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl"
                  >
                    Initialiser par défaut
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-gray-100">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                        <th className="px-6 py-4">ID / Code</th>
                        <th className="px-6 py-4">Nom de la Filière</th>
                        <th className="px-6 py-4">Niveaux d'Études</th>
                        <th className="px-6 py-4 text-center">Statut</th>
                        <th className="px-6 py-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-sm">
                      {filieres.map((fil) => (
                        <tr key={fil.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-blue-600">
                            {fil.id}
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-extrabold text-gray-900">{fil.name}</span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1.5 max-w-md">
                              {fil.levels.map((lvl, index) => (
                                <span key={index} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg text-xs font-medium">
                                  {lvl}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider inline-block",
                              fil.status === 'active' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                            )}>
                              {fil.status === 'active' ? 'Actif' : 'Inactif'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={() => handleOpenFiliereModal(fil)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors inline-flex"
                              title="Modifier"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FORMATS & PRICING GRIDS */}
          {activeTab === 'formats' && (
            <div className="space-y-8">
              
              {/* List of formats */}
              <div className="space-y-3">
                <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  Formats de Licence (Durées autorisées)
                </h3>
                
                {formats.length === 0 ? (
                  <p className="text-xs text-gray-500 italic p-4 border border-dashed rounded-2xl">Aucun format configuré. Cliquez sur le bouton d'initialisation par défaut.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {formats.map((fmt) => (
                      <div key={fmt.id} className="p-4 bg-gray-50/50 rounded-2xl border border-gray-100 flex justify-between items-center">
                        <div>
                          <p className="font-extrabold text-gray-900">{fmt.name}</p>
                          <p className="text-xs font-mono text-gray-400 mt-0.5">ID: {fmt.id} • {fmt.months} mois</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider",
                            fmt.status === 'active' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          )}>
                            {fmt.status === 'active' ? 'Actif' : 'Inactif'}
                          </span>
                          <button
                            onClick={() => handleOpenFormatModal(fmt)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pricing Matrix */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div>
                  <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                    <BadgeEuro className="w-5 h-5 text-green-600" />
                    Grille des Tarifs par Filière
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">Configurez le prix de chaque format de licence ainsi que les pourcentages de commission de parrainage pour chaque filière d'études.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {pricesList.map((lic) => {
                    const isEditing = editingParamsId === lic.id;
                    return (
                      <div key={lic.id} className={cn(
                        "p-5 rounded-3xl border transition-all space-y-4",
                        isEditing 
                          ? "bg-blue-50/50 border-blue-200 ring-2 ring-blue-100" 
                          : "bg-white border-gray-100 hover:border-gray-200 shadow-sm"
                      )}>
                        
                        {/* Header card info */}
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-extrabold text-gray-900 text-lg leading-tight">{lic.name || lic.id}</h4>
                            <span className="inline-block font-mono text-[10px] text-gray-400 font-bold bg-gray-100 px-1.5 py-0.5 rounded mt-1">CODE: {lic.id}</span>
                          </div>
                          
                          {/* Edit / Save toggles */}
                          {isEditing ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleSavePricing(lic.id, lic)}
                                className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all shadow-md shadow-emerald-100 flex items-center gap-1 text-xs font-bold"
                              >
                                <Save className="w-3.5 h-3.5" />
                                Enregistrer
                              </button>
                              <button
                                onClick={() => setEditingParamsId(null)}
                                className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl transition-all"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleEditPricingClick(lic)}
                              className="px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl transition-all text-xs font-bold flex items-center gap-1.5"
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                              Gérer les Tarifs
                            </button>
                          )}
                        </div>

                        {/* Prices inputs or stats */}
                        <div className="space-y-3 bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                          <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Tarification par durée de Licence</p>
                          <div className="grid grid-cols-2 gap-3.5">
                            {formats.filter(f => f.status === 'active').map((fmt) => {
                              // Get current price
                              const priceVal = isEditing 
                                ? (pricingForm.prices[fmt.id] ?? 0)
                                : (lic.prices?.[fmt.id] !== undefined 
                                    ? lic.prices[fmt.id] 
                                    : (fmt.months === 3 ? lic.price3m : fmt.months === 6 ? lic.price6m : fmt.months === 12 ? lic.price12m : fmt.months * 10));

                              return (
                                <div key={fmt.id} className="space-y-1">
                                  <label className="text-xs font-bold text-gray-500">{fmt.name}</label>
                                  {isEditing ? (
                                    <div className="flex items-center bg-white border border-gray-200 rounded-xl px-2.5 py-1">
                                      <input
                                        type="number"
                                        className="w-full text-xs font-bold text-gray-900 focus:outline-none"
                                        value={priceVal}
                                        onChange={(e) => {
                                          const val = Number(e.target.value);
                                          setPricingForm({
                                            ...pricingForm,
                                            prices: {
                                              ...pricingForm.prices,
                                              [fmt.id]: val
                                            }
                                          });
                                        }}
                                      />
                                      <span className="text-[10px] font-bold text-gray-400 ml-1">
                                        {CURRENCIES.find(c => c.code === globalCurrency)?.symbol || globalCurrency}
                                      </span>
                                    </div>
                                  ) : (
                                    <p className="font-extrabold text-blue-600 text-sm">{formatCurrency(priceVal, globalCurrency)}</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Commissions list */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Comm. Code Promo</label>
                            {isEditing ? (
                              <div className="flex items-center bg-white border border-gray-200 rounded-xl px-2.5 py-1 max-w-[120px]">
                                <input
                                  type="number"
                                  className="w-full text-xs font-bold text-gray-900 focus:outline-none"
                                  value={pricingForm.promoCommission}
                                  onChange={(e) => setPricingForm({ ...pricingForm, promoCommission: Number(e.target.value) })}
                                />
                                <span className="text-xs font-bold text-gray-400 ml-1">%</span>
                              </div>
                            ) : (
                              <span className="inline-block font-extrabold text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-xl">
                                {lic.promoCommission || 0} %
                              </span>
                            )}
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Comm. Partenaire</label>
                            {isEditing ? (
                              <div className="flex items-center bg-white border border-gray-200 rounded-xl px-2.5 py-1 max-w-[120px]">
                                <input
                                  type="number"
                                  className="w-full text-xs font-bold text-gray-900 focus:outline-none"
                                  value={pricingForm.partnerCommission}
                                  onChange={(e) => setPricingForm({ ...pricingForm, partnerCommission: Number(e.target.value) })}
                                />
                                <span className="text-xs font-bold text-gray-400 ml-1">%</span>
                              </div>
                            ) : (
                              <span className="inline-block font-extrabold text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-xl">
                                {lic.partnerCommission || 0} %
                              </span>
                            )}
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {activeTab === 'chapters' && (
            <div className="space-y-6 animate-in fade-in duration-250">
              
              {/* Summary Mini-Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/30 p-5 rounded-2xl border border-blue-100 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Chapitres Enregistrés</span>
                    <p className="text-xl font-extrabold text-blue-900 mt-1">{chapters.length}</p>
                    <p className="text-[10px] text-gray-400 font-medium">Détectés sur la plateforme</p>
                  </div>
                  <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                    <Book className="w-5 h-5" />
                  </div>
                </div>

                <div className="bg-gradient-to-br from-emerald-50/30 to-teal-50/20 p-5 rounded-2xl border border-emerald-100 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Livres Actifs</span>
                    <p className="text-xl font-extrabold text-emerald-900 mt-1">
                      {new Set(chapters.map(c => c.bookId)).size}
                    </p>
                    <p className="text-[10px] text-emerald-600 font-semibold">Ayant au moins un chapitre</p>
                  </div>
                  <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                    <BookOpen className="w-5 h-5" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Create Chapter Form */}
                <div className="bg-white p-6 rounded-2xl border border-gray-150 shadow-sm h-auto space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
                      <PlusCircle className="w-5 h-5 text-blue-500" />
                      Créer un Chapitre
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">Ajoutez un nouveau chapitre indépendant.</p>
                  </div>

                  <form onSubmit={handleCreateChapter} className="space-y-4">
                    {/* Chapter Title */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-650 block">Nom du Chapitre</label>
                      <input
                        type="text"
                        value={newChapterTitle}
                        onChange={(e) => setNewChapterTitle(e.target.value)}
                        placeholder="Ex: cardiologie, parasitologie"
                        className="w-full text-xs font-bold p-3 border border-gray-205 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 text-gray-900"
                        required
                      />
                      <p className="text-[10px] text-gray-400 font-medium">Sera enregistré en minuscules pour correspondre aux indexations.</p>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingChapter || !newChapterTitle.trim()}
                      className="w-full p-3 bg-blue-600 font-bold text-xs text-white rounded-xl hover:bg-blue-700 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md uppercase tracking-wider"
                    >
                      {isSubmittingChapter ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Création...
                        </>
                      ) : (
                        <>
                          <PlusCircle className="w-3.5 h-3.5" />
                          Enregistrer
                        </>
                      )}
                    </button>
                  </form>
                </div>

                {/* List / Register Table */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-sm">
                  <div className="px-5 py-4 border-b border-gray-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
                    <div>
                      <h3 className="text-base font-bold text-gray-900 tracking-tight">Registre des Chapitres</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Liste des chapitres configurés par livre.</p>
                    </div>
                    
                    {/* Search */}
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                        <Filter className="w-3.5 h-3.5 text-gray-400" />
                      </span>
                      <input
                        type="text"
                        value={searchChapter}
                        onChange={(e) => setSearchChapter(e.target.value)}
                        placeholder="Filtrer..."
                        className="pl-9 pr-4 py-1.5 text-xs font-bold text-gray-800 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full sm:w-40"
                      />
                    </div>
                  </div>

                  {chapters.length === 0 ? (
                    <div className="p-16 text-center text-gray-400 bg-white">
                      <Book className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p className="text-sm font-bold">Aucun chapitre créé</p>
                      <p className="text-xs mt-1">Utilisez le formulaire pour enregistrer un nouveau chapitre sous un livre.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto bg-white">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-gray-150 bg-gray-50/50">
                            <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Nom du Chapitre</th>
                            <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Livre affilié</th>
                            <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Filière</th>
                            <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Niveau</th>
                            <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-xs">
                          {chapters
                            .filter(c => (c.title || '').toLowerCase().includes(searchChapter.toLowerCase()))
                            .map((c) => {
                              const associatedBook = books.find(b => b.id === c.bookId);
                              return (
                                <tr key={c.id} className="hover:bg-gray-50/30 transition-colors">
                                  {/* CHAPTER TITLE */}
                                  <td className="px-5 py-3.5 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 font-bold rounded-lg border border-blue-100 uppercase">
                                      <Book className="w-3 h-3 text-blue-600" />
                                      {c.title}
                                    </span>
                                  </td>

                                  {/* BOOK NAME */}
                                  <td className="px-5 py-3.5 whitespace-nowrap">
                                    <span className="font-semibold text-gray-900">
                                      {associatedBook ? associatedBook.name : 'Général / Indépendant'}
                                    </span>
                                  </td>

                                  {/* FILIÈRE */}
                                  <td className="px-5 py-3.5 text-center whitespace-nowrap font-bold text-gray-600">
                                    {c.filiere || 'ECN'}
                                  </td>

                                  {/* NIVEAU */}
                                  <td className="px-5 py-3.5 text-center whitespace-nowrap font-bold text-gray-600">
                                    <span className="px-2 py-0.5 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg">
                                      {c.niveau || 'ALL'}
                                    </span>
                                  </td>

                                  {/* ACTIONS */}
                                  <td className="px-5 py-3.5 text-center whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteChapter(c.id, c.title)}
                                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                      title="Supprimer le chapitre"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
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
            </div>
          )}
        </>
      )}

      {/* FILIERE ADD/EDIT MODAL */}
      {showFiliereModal && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-display font-bold text-lg text-gray-900">
                {editingFiliere ? 'Modifier la Filière' : 'Ajouter une Filière'}
              </h3>
              <button
                onClick={() => setShowFiliereModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveFiliere} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">ID / Code unique *</label>
                <input
                  type="text"
                  required
                  disabled={!!editingFiliere}
                  placeholder="ex: IDE, SF, PHARMA"
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-400"
                  value={filiereForm.id}
                  onChange={(e) => setFiliereForm({ ...filiereForm, id: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">Nom complet de la filière *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Infirmier d'État (IDE)"
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={filiereForm.name}
                  onChange={(e) => setFiliereForm({ ...filiereForm, name: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">Niveaux d'études (séparés par des virgules) *</label>
                <input
                  type="text"
                  required
                  placeholder="ALL, Niveau 1, Niveau 2, Niveau 3"
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={filiereForm.levelsStr}
                  onChange={(e) => setFiliereForm({ ...filiereForm, levelsStr: e.target.value })}
                />
                <span className="text-[10px] text-gray-400 block mt-0.5">Note: Le niveau 'ALL' ou 'ALL' doit toujours être disponible.</span>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">Statut d'accès</label>
                <select
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-white"
                  value={filiereForm.status}
                  onChange={(e) => setFiliereForm({ ...filiereForm, status: e.target.value as any })}
                >
                  <option value="active">Actif (Inscription permise)</option>
                  <option value="inactive">Inactif</option>
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowFiliereModal(false)}
                  className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-100"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LICENSEFORMAT ADD/EDIT MODAL */}
      {showFormatModal && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-display font-bold text-lg text-gray-900">
                {editingFormat ? 'Modifier le Format de Licence' : 'Ajouter un Format de Licence'}
              </h3>
              <button
                onClick={() => setShowFormatModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveFormat} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">ID / Code unique *</label>
                <input
                  type="text"
                  required
                  disabled={!!editingFormat}
                  placeholder="ex: 1m, 3m, 6m, 12m, 24m"
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-400"
                  value={formatForm.id}
                  onChange={(e) => setFormatForm({ ...formatForm, id: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">Nom du format de licence *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Formule 3 Mois, Formule Premium 6M"
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={formatForm.name}
                  onChange={(e) => setFormatForm({ ...formatForm, name: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">Durée de validité (en Mois) *</label>
                <input
                  type="number"
                  required
                  min="1"
                  max="120"
                  placeholder="3"
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={formatForm.months}
                  onChange={(e) => setFormatForm({ ...formatForm, months: Number(e.target.value) })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 block">Statut d'utilisation</label>
                <select
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-white"
                  value={formatForm.status}
                  onChange={(e) => setFormatForm({ ...formatForm, status: e.target.value as any })}
                >
                  <option value="active">Actif (Affiché à l'achat)</option>
                  <option value="inactive">Inactif</option>
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowFormatModal(false)}
                  className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-100"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
