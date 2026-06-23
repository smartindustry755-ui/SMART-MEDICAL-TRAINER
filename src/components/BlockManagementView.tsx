import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, updateDoc, orderBy } from 'firebase/firestore';
import { LayoutGrid, ChevronRight, Settings, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

function BlockManagementView({ books }: { books: any[] }) {
  const [chapters, setChapters] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingBlock, setEditingBlock] = useState<any>(null);
  const [movingBlock, setMovingBlock] = useState<any>(null);
  const [newTitle, setNewTitle] = useState('');
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [targetBookId, setTargetBookId] = useState<string | null>(null);
  const [targetChapterId, setTargetChapterId] = useState<string | null>(null);
  const [targetChapters, setTargetChapters] = useState<any[]>([]);

  const fetchChapters = async (bookId: string) => {
    setSelectedBookId(bookId);
    setSelectedChapterId(null);
    const q = query(collection(db, 'chapters'), where('bookId', '==', bookId), orderBy('title', 'asc'));
    const snap = await getDocs(q);
    setChapters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    setBlocks([]);
  };

  const fetchTargetChapters = async (bookId: string) => {
    setTargetBookId(bookId);
    setTargetChapterId(null);
    const q = query(collection(db, 'chapters'), where('bookId', '==', bookId), orderBy('title', 'asc'));
    const snap = await getDocs(q);
    setTargetChapters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const fetchBlocks = async (chapterId: string) => {
    setSelectedChapterId(chapterId);
    const q = query(collection(db, 'blocks'), where('chapterId', '==', chapterId), orderBy('importDate', 'desc'));
    const snap = await getDocs(q);
    setBlocks(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const handleUpdateBlock = async () => {
    if (!editingBlock || !newTitle.trim()) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'blocks', editingBlock.id), {
        blockTitle: newTitle.trim()
      });
      setBlocks(prev => prev.map(b => b.id === editingBlock.id ? { ...b, blockTitle: newTitle.trim() } : b));
      setEditingBlock(null);
      setNewTitle('');
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la mise à jour du bloc.");
    } finally {
      setLoading(false);
    }
  };

  const handleMoveBlock = async () => {
    if (!movingBlock || !targetChapterId) return;
    setLoading(true);
    try {
      // Update block's chapterId
      await updateDoc(doc(db, 'blocks', movingBlock.id), {
        chapterId: targetChapterId
      });

      // Update all questions in this block
      const questionsSnap = await getDocs(query(collection(db, 'questions'), where('blockId', '==', movingBlock.id)));
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
      if (qCount > 0) {
        await qBatch.commit();
      }

      setBlocks(prev => prev.filter(b => b.id !== movingBlock.id));
      setMovingBlock(null);
      setTargetBookId(null);
      setTargetChapterId(null);
      alert("Bloc déplacé avec succès !");
    } catch (err) {
      console.error(err);
      alert("Erreur lors du déplacement du bloc.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-[2rem] p-6 md:p-8 border border-gray-200/60 shadow-xl shadow-blue-900/5">
        <h3 className="text-2xl font-display font-bold text-gray-900 mb-8 flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-xl"><LayoutGrid className="w-6 h-6 text-blue-600" /></div>
          Gestion des blocs
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Books */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mb-6">Livres</h4>
            <div className="space-y-2">
              {books.map(book => (
                <button
                  key={book.id}
                  onClick={() => fetchChapters(book.id)}
                  className={cn(
                    "w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between group",
                    selectedBookId === book.id ? "border-blue-500 bg-blue-50 shadow-sm" : "border-gray-100 hover:border-blue-200 hover:bg-gray-50"
                  )}
                >
                  <span className={cn("font-bold", selectedBookId === book.id ? "text-blue-700" : "text-gray-700")}>{book.name}</span>
                  <ChevronRight className={cn("w-4 h-4 transition-colors", selectedBookId === book.id ? "text-blue-500" : "text-gray-400 group-hover:text-blue-500")} />
                </button>
              ))}
            </div>
          </div>

          {/* Chapters */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mb-6">Chapitres</h4>
            <div className="space-y-2">
              {!selectedBookId && <p className="text-gray-400 italic p-4 text-sm">Sélectionnez un livre</p>}
              {chapters.map(chapter => (
                <button
                  key={chapter.id}
                  onClick={() => fetchBlocks(chapter.id)}
                  className={cn(
                    "w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between group",
                    selectedChapterId === chapter.id ? "border-blue-500 bg-blue-50 shadow-sm" : "border-gray-100 hover:border-blue-200 hover:bg-gray-50"
                  )}
                >
                  <span className={cn("font-bold", selectedChapterId === chapter.id ? "text-blue-700" : "text-gray-700")}>{chapter.title}</span>
                  <ChevronRight className={cn("w-4 h-4 transition-colors", selectedChapterId === chapter.id ? "text-blue-500" : "text-gray-400 group-hover:text-blue-500")} />
                </button>
              ))}
              {selectedBookId && chapters.length === 0 && <p className="text-gray-400 italic p-4 text-sm">Aucun chapitre</p>}
            </div>
          </div>

          {/* Blocks */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mb-6">Blocs</h4>
            <div className="space-y-2">
              {!selectedChapterId && <p className="text-gray-400 italic p-4 text-sm">Sélectionnez un chapitre</p>}
              {blocks.map(block => (
                <div
                  key={block.id}
                  className="w-full p-4 rounded-2xl border border-gray-100 bg-white flex items-center justify-between group hover:border-blue-200 transition-all"
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-gray-700">{block.blockTitle || "Bloc sans nom"}</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">{block.questionsCount || 0} questions</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setEditingBlock(block);
                        setNewTitle(block.blockTitle || '');
                      }}
                      className="p-2.5 hover:bg-blue-50 text-blue-600 rounded-xl transition-colors border border-transparent hover:border-blue-100"
                      title="Renommer"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => {
                        setMovingBlock(block);
                        setTargetBookId(null);
                        setTargetChapterId(null);
                      }}
                      className="p-2.5 hover:bg-emerald-50 text-emerald-600 rounded-xl transition-colors border border-transparent hover:border-emerald-100"
                      title="Déplacer"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
              {selectedChapterId && blocks.length === 0 && <p className="text-gray-400 italic p-4 text-sm">Aucun bloc</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingBlock && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-200">
            <h3 className="text-2xl font-display font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-xl"><Settings className="w-6 h-6 text-blue-600" /></div>
              Modifier le bloc
            </h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Titre du bloc</label>
                <input 
                  type="text" 
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ex: Pédiatrie générale"
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div className="flex gap-4 pt-2">
                <button 
                  onClick={() => setEditingBlock(null)}
                  className="flex-1 px-6 py-4 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleUpdateBlock}
                  disabled={loading}
                  className="flex-1 px-6 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 disabled:opacity-50 flex items-center justify-center"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sauvegarder"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {movingBlock && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-200">
            <h3 className="text-2xl font-display font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div className="p-2 bg-emerald-50 rounded-xl"><ChevronRight className="w-6 h-6 text-emerald-600" /></div>
              Déplacer le bloc
            </h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Livre de destination</label>
                <select
                  value={targetBookId || ''}
                  onChange={(e) => fetchTargetChapters(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  <option value="">Sélectionner un livre</option>
                  {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              {targetBookId && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Chapitre de destination</label>
                  <select
                    value={targetChapterId || ''}
                    onChange={(e) => setTargetChapterId(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                  >
                    <option value="">Sélectionner un chapitre</option>
                    {targetChapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              )}
              <div className="flex gap-4 pt-2">
                <button 
                  onClick={() => setMovingBlock(null)}
                  className="flex-1 px-6 py-4 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleMoveBlock}
                  disabled={loading || !targetChapterId}
                  className="flex-1 px-6 py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200 disabled:opacity-50 flex items-center justify-center"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Déplacer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BlockManagementView;
