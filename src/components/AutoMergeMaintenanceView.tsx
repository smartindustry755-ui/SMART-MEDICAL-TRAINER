import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, deleteDoc, orderBy, onSnapshot } from 'firebase/firestore';
import { Loader2, Plus } from 'lucide-react';

function AutoMergeMaintenanceView() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null);

  const [books, setBooks] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [sourceChapterId, setSourceChapterId] = useState<string | null>(null);
  const [targetChapterId, setTargetChapterId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'books'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setBooks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'books');
    });
    return () => unsubscribe();
  }, []);

  const fetchChapters = async (bookId: string) => {
    setSelectedBookId(bookId);
    setSourceChapterId(null);
    setTargetChapterId(null);
    const q = query(collection(db, 'chapters'), where('bookId', '==', bookId), orderBy('title', 'asc'));
    const snap = await getDocs(q);
    setChapters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const handleMergeCustom = async () => {
    if (!sourceChapterId || !targetChapterId || sourceChapterId === targetChapterId) return;

    setConfirmDialog({
      isOpen: true,
      title: "Fusionner les chapitres",
      message: "Êtes-vous sûr de vouloir fusionner ces chapitres ? Tous les blocs et questions du chapitre source seront déplacés vers le chapitre cible, et le chapitre source sera supprimé.",
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoading(true);
        setStatus("Démarrage de la fusion...");
        try {
          // Move blocks
          const blocksSnap = await getDocs(query(collection(db, 'blocks'), where('chapterId', '==', sourceChapterId)));
          let bBatch = writeBatch(db);
          let bCount = 0;
          for (const bDoc of blocksSnap.docs) {
            bBatch.update(bDoc.ref, { chapterId: targetChapterId });
            bCount++;
            if (bCount >= 400) {
              await bBatch.commit();
              bBatch = writeBatch(db);
              bCount = 0;
            }
          }
          if (bCount > 0) await bBatch.commit();

          // Move questions
          const questionsSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', '==', sourceChapterId)));
          let qBatch = writeBatch(db);
          let qCount = 0;
          for (const qDoc of questionsSnap.docs) {
            qBatch.update(qDoc.ref, { chapterId: targetChapterId });
            qCount++;
            if (qCount >= 400) {
              await qBatch.commit();
              qBatch = writeBatch(db);
              qCount = 0;
            }
          }
          if (qCount > 0) await qBatch.commit();

          // Delete source chapter
          await deleteDoc(doc(db, 'chapters', sourceChapterId));

          setStatus("Fusion terminée avec succès !");
          if (selectedBookId) fetchChapters(selectedBookId);
        } catch (err: any) {
          console.error(err);
          setStatus("Erreur lors de la fusion : " + err.message);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleMergeChirurgie = async () => {
    setConfirmDialog({
      isOpen: true,
      title: "Fusionner les chapitres",
      message: "Êtes-vous sûr de vouloir fusionner tous les chapitres 'Chirurgie' ? Cette action est irréversible.",
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoading(true);
        setStatus("Démarrage de la fusion des chapitres de chirurgie...");
        try {
          const booksSnap = await getDocs(collection(db, 'books'));
          const books = booksSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

          for (const book of books) {
            const chaptersSnap = await getDocs(query(collection(db, 'chapters'), where('bookId', '==', book.id)));
            const chapters = chaptersSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

            // Find chapters that match "chirurgie" (case insensitive)
            const chirurgieChapters = chapters.filter(c => (c.title || '').toLowerCase().trim() === 'chirurgie');

            if (chirurgieChapters.length > 1) {
              setStatus(`Fusion de ${chirurgieChapters.length} chapitres pour le livre ${book.name}...`);
              const masterChapter = chirurgieChapters[0];
              const redundantChapters = chirurgieChapters.slice(1);

              for (const chapter of redundantChapters) {
                // Move blocks
                const blocksSnap = await getDocs(query(collection(db, 'blocks'), where('chapterId', '==', chapter.id)));
                let bBatch = writeBatch(db);
                let bCount = 0;
                for (const bDoc of blocksSnap.docs) {
                  bBatch.update(bDoc.ref, { chapterId: masterChapter.id });
                  bCount++;
                  if (bCount >= 400) {
                    await bBatch.commit();
                    bBatch = writeBatch(db);
                    bCount = 0;
                  }
                }
                await bBatch.commit();

                // Move questions
                const questionsSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', '==', chapter.id)));
                let qBatch = writeBatch(db);
                let qCount = 0;
                for (const qDoc of questionsSnap.docs) {
                  qBatch.update(qDoc.ref, { chapterId: masterChapter.id });
                  qCount++;
                  if (qCount >= 400) {
                    await qBatch.commit();
                    qBatch = writeBatch(db);
                    qCount = 0;
                  }
                }
                await qBatch.commit();

                // Delete redundant chapter
                await deleteDoc(doc(db, 'chapters', chapter.id));
              }
            }
          }
          setStatus("Fusion terminée avec succès !");
        } catch (err: any) {
          console.error(err);
          setStatus("Erreur lors de la fusion : " + err.message);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-gray-600 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
              >
                Annuler
              </button>
              <button 
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 bg-amber-50 border border-amber-100 rounded-2xl">
        <h4 className="font-bold text-amber-900 mb-2">Fusion personnalisée de chapitres</h4>
        <p className="text-sm text-amber-800 mb-4">
          Sélectionnez un livre, puis un chapitre source et un chapitre cible. Tous les blocs et questions du chapitre source seront déplacés vers le chapitre cible, et le chapitre source sera supprimé.
        </p>
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-bold text-amber-900 mb-2 uppercase tracking-wider">Livre</label>
            <select
              value={selectedBookId || ''}
              onChange={(e) => fetchChapters(e.target.value)}
              className="w-full p-3 bg-white border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none transition-all"
            >
              <option value="">Sélectionner un livre</option>
              {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {selectedBookId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-amber-900 mb-2 uppercase tracking-wider">Chapitre Source (à supprimer)</label>
                <select
                  value={sourceChapterId || ''}
                  onChange={(e) => setSourceChapterId(e.target.value)}
                  className="w-full p-3 bg-white border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                >
                  <option value="">Sélectionner un chapitre</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-amber-900 mb-2 uppercase tracking-wider">Chapitre Cible (à conserver)</label>
                <select
                  value={targetChapterId || ''}
                  onChange={(e) => setTargetChapterId(e.target.value)}
                  className="w-full p-3 bg-white border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                >
                  <option value="">Sélectionner un chapitre</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={handleMergeCustom}
          disabled={loading || !sourceChapterId || !targetChapterId || sourceChapterId === targetChapterId}
          className="px-6 py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Fusionner les chapitres
        </button>
      </div>

      <div className="p-6 bg-amber-50 border border-amber-100 rounded-2xl">
        <h4 className="font-bold text-amber-900 mb-2">Fusion automatique des chapitres "Chirurgie"</h4>
        <p className="text-sm text-amber-800 mb-4">
          Cette action va regrouper tous les chapitres nommés "chirurgie" en un seul par livre, 
          en déplaçant tous les blocs et questions associés. Cela résoudra le problème des doublons de chapitres.
        </p>
        <button
          onClick={handleMergeChirurgie}
          disabled={loading}
          className="px-6 py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Lancer la fusion automatique
        </button>
      </div>

      {status && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-700">
          {status}
        </div>
      )}
    </div>
  );
}

export default AutoMergeMaintenanceView;
