import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, query, getDocs, writeBatch, doc, deleteDoc, updateDoc, where, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { Loader2, Plus, Trash2, Edit2, ChevronRight, AlertTriangle, CheckSquare, Square, Folder, Book, LayoutGrid } from 'lucide-react';
import { cn } from '../lib/utils';

export default function AdvancedMaintenanceView() {
  const [activeTab, setActiveTab] = useState<'blocks' | 'chapters' | 'books'>('blocks');

  return (
    <div className="bg-white rounded-[2rem] p-6 md:p-8 border border-gray-200/60 shadow-xl shadow-blue-900/5">
      <h3 className="text-2xl font-display font-bold text-gray-900 mb-8 flex items-center gap-3">
        <div className="p-2 bg-amber-50 rounded-xl"><AlertTriangle className="w-6 h-6 text-amber-600" /></div>
        Maintenance Avancée du Contenu
      </h3>

      <div className="flex gap-4 mb-8 border-b border-gray-100 pb-4 overflow-x-auto">
        <button onClick={() => setActiveTab('blocks')} className={cn("px-6 py-3 font-bold rounded-xl transition-all flex items-center gap-2", activeTab === 'blocks' ? "bg-amber-100 text-amber-700" : "text-gray-500 hover:bg-gray-50")}>
          <LayoutGrid className="w-5 h-5" /> Blocs
        </button>
        <button onClick={() => setActiveTab('chapters')} className={cn("px-6 py-3 font-bold rounded-xl transition-all flex items-center gap-2", activeTab === 'chapters' ? "bg-amber-100 text-amber-700" : "text-gray-500 hover:bg-gray-50")}>
          <Folder className="w-5 h-5" /> Chapitres
        </button>
        <button onClick={() => setActiveTab('books')} className={cn("px-6 py-3 font-bold rounded-xl transition-all flex items-center gap-2", activeTab === 'books' ? "bg-amber-100 text-amber-700" : "text-gray-500 hover:bg-gray-50")}>
          <Book className="w-5 h-5" /> Livres
        </button>
      </div>

      {activeTab === 'blocks' && <MaintenanceBlocksTab />}
      {activeTab === 'chapters' && <MaintenanceChaptersTab />}
      {activeTab === 'books' && <MaintenanceBooksTab />}
    </div>
  );
}

function MaintenanceBlocksTab() {
  const [books, setBooks] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // Modals
  const [movingBlock, setMovingBlock] = useState<any>(null);
  const [renamingBlock, setRenamingBlock] = useState<any>(null);
  const [merging, setMerging] = useState(false);
  const [deletingBlock, setDeletingBlock] = useState<any>(null);
  
  const [targetBookId, setTargetBookId] = useState('');
  const [targetChapterId, setTargetChapterId] = useState('');
  const [newName, setNewName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [bSnap, cSnap, blSnap] = await Promise.all([
        getDocs(collection(db, 'books')),
        getDocs(collection(db, 'chapters')),
        getDocs(collection(db, 'blocks'))
      ]);
      setBooks(bSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setChapters(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBlocks(blSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getChapterName = (chapterId: string) => chapters.find(c => c.id === chapterId)?.title || 'Inconnu';
  const getBookName = (chapterId: string) => {
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return 'Inconnu';
    return books.find(b => b.id === chapter.bookId)?.name || 'Inconnu';
  };

  const filteredBlocks = blocks.filter(b => 
    (b.blockTitle || '').toLowerCase().includes(search.toLowerCase()) ||
    getChapterName(b.chapterId).toLowerCase().includes(search.toLowerCase()) ||
    getBookName(b.chapterId).toLowerCase().includes(search.toLowerCase())
  );

  const handleMove = async () => {
    if (!movingBlock || !targetChapterId) return;
    setActionLoading(true);
    try {
      // Check for collision
      const existingBlock = blocks.find(b => b.chapterId === targetChapterId && b.blockTitle === movingBlock.blockTitle && b.id !== movingBlock.id);
      let finalTitle = movingBlock.blockTitle;
      if (existingBlock) {
        finalTitle = `${movingBlock.blockTitle}_copy`;
      }

      await updateDoc(doc(db, 'blocks', movingBlock.id), { chapterId: targetChapterId, blockTitle: finalTitle });
      
      const qSnap = await getDocs(query(collection(db, 'questions'), where('blockId', '==', movingBlock.id)));
      let batch = writeBatch(db);
      let count = 0;
      for (const qDoc of qSnap.docs) {
        batch.update(qDoc.ref, { chapterId: targetChapterId });
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      
      setMovingBlock(null);
      alert("Bloc déplacé avec succès");
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors du déplacement");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRename = async () => {
    if (!renamingBlock || !newName.trim()) return;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'blocks', renamingBlock.id), { blockTitle: newName.trim() });
      setRenamingBlock(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors du renommage.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingBlock) return;
    setActionLoading(true);
    try {
      await deleteDoc(doc(db, 'blocks', deletingBlock.id));
      
      const qSnap = await getDocs(query(collection(db, 'questions'), where('blockId', '==', deletingBlock.id)));
      let batch = writeBatch(db);
      let count = 0;
      for (const qDoc of qSnap.docs) {
        batch.delete(qDoc.ref);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      
      setDeletingBlock(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la suppression.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMerge = async () => {
    if (selectedBlocks.length < 2 || !newName.trim() || !targetChapterId) return;
    setActionLoading(true);
    try {
      // Create new block
      const newBlockRef = await addDoc(collection(db, 'blocks'), {
        blockTitle: newName.trim(),
        chapterId: targetChapterId,
        importDate: serverTimestamp(),
        questionsCount: 0 // Will update later
      });

      let totalQuestions = 0;
      let batch = writeBatch(db);
      let count = 0;

      for (const blockId of selectedBlocks) {
        const qSnap = await getDocs(query(collection(db, 'questions'), where('blockId', '==', blockId)));
        totalQuestions += qSnap.size;
        for (const qDoc of qSnap.docs) {
          batch.update(qDoc.ref, { blockId: newBlockRef.id, chapterId: targetChapterId });
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        batch.delete(doc(db, 'blocks', blockId));
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();

      await updateDoc(newBlockRef, { questionsCount: totalQuestions });

      setMerging(false);
      setSelectedBlocks([]);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la fusion.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <input 
          type="text" 
          placeholder="Rechercher un bloc..." 
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="p-3 bg-gray-50 border border-gray-200 rounded-xl w-64"
        />
        {selectedBlocks.length > 1 && (
          <button 
            onClick={() => { setMerging(true); setNewName(''); setTargetChapterId(''); setTargetBookId(''); }}
            className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold flex items-center gap-2"
          >
            Fusionner ({selectedBlocks.length})
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="p-4 w-12">
                  <button onClick={() => setSelectedBlocks(selectedBlocks.length === filteredBlocks.length ? [] : filteredBlocks.map(b => b.id))}>
                    {selectedBlocks.length === filteredBlocks.length && filteredBlocks.length > 0 ? <CheckSquare className="w-5 h-5 text-amber-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                  </button>
                </th>
                <th className="p-4 font-bold text-gray-600">Nom du bloc</th>
                <th className="p-4 font-bold text-gray-600">Chapitre</th>
                <th className="p-4 font-bold text-gray-600">Livre</th>
                <th className="p-4 font-bold text-gray-600">Questions</th>
                <th className="p-4 font-bold text-gray-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredBlocks.map(block => (
                <tr key={block.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4">
                    <button onClick={() => setSelectedBlocks(prev => prev.includes(block.id) ? prev.filter(id => id !== block.id) : [...prev, block.id])}>
                      {selectedBlocks.includes(block.id) ? <CheckSquare className="w-5 h-5 text-amber-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                    </button>
                  </td>
                  <td className="p-4 font-medium text-gray-900">{block.blockTitle || 'Sans nom'}</td>
                  <td className="p-4 text-gray-600">{getChapterName(block.chapterId)}</td>
                  <td className="p-4 text-gray-600">{getBookName(block.chapterId)}</td>
                  <td className="p-4 text-gray-600">{block.questionsCount || 0}</td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => { setMovingBlock(block); setTargetBookId(''); setTargetChapterId(''); }} className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg flex items-center gap-1" title="Déplacer">
                      Déplacer
                    </button>
                    <button onClick={() => { setRenamingBlock(block); setNewName(block.blockTitle || ''); }} className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg" title="Renommer"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setDeletingBlock(block)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {movingBlock && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Déplacer le bloc</h3>
            <p className="text-sm text-gray-600 mb-4">
              Tu es sur le point de déplacer un bloc contenant {movingBlock.questionsCount || 0} questions.<br/>
              Continuer ?
            </p>
            <div className="space-y-4 mb-6">
              <select value={targetBookId} onChange={e => { setTargetBookId(e.target.value); setTargetChapterId(''); }} className="w-full p-3 border rounded-xl">
                <option value="">Sélectionner un livre cible</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {targetBookId && (
                <select value={targetChapterId} onChange={e => setTargetChapterId(e.target.value)} className="w-full p-3 border rounded-xl">
                  <option value="">Sélectionner un chapitre cible</option>
                  {chapters.filter(c => c.bookId === targetBookId).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setMovingBlock(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleMove} disabled={!targetChapterId || actionLoading} className="flex-1 py-2 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer déplacement</button>
            </div>
          </div>
        </div>
      )}

      {renamingBlock && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Renommer le bloc</h3>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-3 border rounded-xl mb-6" placeholder="Nouveau nom" />
            <div className="flex gap-3">
              <button onClick={() => setRenamingBlock(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleRename} disabled={!newName.trim() || actionLoading} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {deletingBlock && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-red-600">Supprimer le bloc</h3>
            <p className="text-sm text-gray-600 mb-6">Tu es sur le point de supprimer le bloc "{deletingBlock.blockTitle}" et ses {deletingBlock.questionsCount || 0} questions. Cette action est irréversible. Continuer ?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingBlock(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleDelete} disabled={actionLoading} className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold disabled:opacity-50">Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {merging && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Fusionner {selectedBlocks.length} blocs</h3>
            <p className="text-sm text-gray-600 mb-4">Tu es sur le point de fusionner {selectedBlocks.length} blocs (environ {selectedBlocks.reduce((acc, id) => acc + (blocks.find(b => b.id === id)?.questionsCount || 0), 0)} questions). Les anciens blocs seront supprimés.</p>
            <div className="space-y-4 mb-6">
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-3 border rounded-xl" placeholder="Nom du nouveau bloc" />
              <select value={targetBookId} onChange={e => { setTargetBookId(e.target.value); setTargetChapterId(''); }} className="w-full p-3 border rounded-xl">
                <option value="">Sélectionner un livre cible</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {targetBookId && (
                <select value={targetChapterId} onChange={e => setTargetChapterId(e.target.value)} className="w-full p-3 border rounded-xl">
                  <option value="">Sélectionner un chapitre cible</option>
                  {chapters.filter(c => c.bookId === targetBookId).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setMerging(false)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleMerge} disabled={!newName.trim() || !targetChapterId || actionLoading} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MaintenanceChaptersTab() {
  const [books, setBooks] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // Modals
  const [movingChapter, setMovingChapter] = useState<any>(null);
  const [renamingChapter, setRenamingChapter] = useState<any>(null);
  const [merging, setMerging] = useState(false);
  const [deletingChapter, setDeletingChapter] = useState<any>(null);
  
  const [targetBookId, setTargetBookId] = useState('');
  const [targetChapterId, setTargetChapterId] = useState('');
  const [newName, setNewName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [bSnap, cSnap, blSnap] = await Promise.all([
        getDocs(collection(db, 'books')),
        getDocs(collection(db, 'chapters')),
        getDocs(collection(db, 'blocks'))
      ]);
      setBooks(bSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setChapters(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBlocks(blSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getBookName = (bookId: string) => books.find(b => b.id === bookId)?.name || 'Inconnu';
  const getBlockCount = (chapterId: string) => blocks.filter(b => b.chapterId === chapterId).length;

  const filteredChapters = chapters.filter(c => 
    (c.title || '').toLowerCase().includes(search.toLowerCase()) ||
    getBookName(c.bookId).toLowerCase().includes(search.toLowerCase())
  );

  const handleMove = async () => {
    if (!movingChapter || !targetBookId) return;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'chapters', movingChapter.id), { bookId: targetBookId });
      setMovingChapter(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors du déplacement.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRename = async () => {
    if (!renamingChapter || !newName.trim()) return;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'chapters', renamingChapter.id), { title: newName.trim() });
      setRenamingChapter(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors du renommage.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingChapter) return;
    setActionLoading(true);
    try {
      // Delete chapter
      await deleteDoc(doc(db, 'chapters', deletingChapter.id));
      
      // Delete blocks
      const blocksToDelete = blocks.filter(b => b.chapterId === deletingChapter.id);
      let batch = writeBatch(db);
      let count = 0;
      for (const b of blocksToDelete) {
        batch.delete(doc(db, 'blocks', b.id));
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();

      // Delete questions
      const qSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', '==', deletingChapter.id)));
      batch = writeBatch(db);
      count = 0;
      for (const qDoc of qSnap.docs) {
        batch.delete(qDoc.ref);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      
      setDeletingChapter(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la suppression.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMerge = async () => {
    if (selectedChapters.length < 2 || !targetChapterId) return;
    setActionLoading(true);
    try {
      const sourceChapters = selectedChapters.filter(id => id !== targetChapterId);
      
      let batch = writeBatch(db);
      let count = 0;

      for (const chapterId of sourceChapters) {
        // Move blocks
        const blocksToMove = blocks.filter(b => b.chapterId === chapterId);
        for (const b of blocksToMove) {
          batch.update(doc(db, 'blocks', b.id), { chapterId: targetChapterId });
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }

        // Move questions
        const qSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', '==', chapterId)));
        for (const qDoc of qSnap.docs) {
          batch.update(qDoc.ref, { chapterId: targetChapterId });
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }

        // Delete source chapter
        batch.delete(doc(db, 'chapters', chapterId));
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();

      setMerging(false);
      setSelectedChapters([]);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la fusion.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <input 
          type="text" 
          placeholder="Rechercher un chapitre..." 
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="p-3 bg-gray-50 border border-gray-200 rounded-xl w-64"
        />
        {selectedChapters.length > 1 && (
          <button 
            onClick={() => { setMerging(true); setTargetChapterId(''); }}
            className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold flex items-center gap-2"
          >
            Fusionner ({selectedChapters.length})
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="p-4 w-12">
                  <button onClick={() => setSelectedChapters(selectedChapters.length === filteredChapters.length ? [] : filteredChapters.map(c => c.id))}>
                    {selectedChapters.length === filteredChapters.length && filteredChapters.length > 0 ? <CheckSquare className="w-5 h-5 text-amber-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                  </button>
                </th>
                <th className="p-4 font-bold text-gray-600">Nom du chapitre</th>
                <th className="p-4 font-bold text-gray-600">Livre</th>
                <th className="p-4 font-bold text-gray-600">Blocs</th>
                <th className="p-4 font-bold text-gray-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredChapters.map(chapter => (
                <tr key={chapter.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4">
                    <button onClick={() => setSelectedChapters(prev => prev.includes(chapter.id) ? prev.filter(id => id !== chapter.id) : [...prev, chapter.id])}>
                      {selectedChapters.includes(chapter.id) ? <CheckSquare className="w-5 h-5 text-amber-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                    </button>
                  </td>
                  <td className="p-4 font-medium text-gray-900">{chapter.title || 'Sans nom'}</td>
                  <td className="p-4 text-gray-600">{getBookName(chapter.bookId)}</td>
                  <td className="p-4 text-gray-600">{getBlockCount(chapter.id)}</td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => { setMovingChapter(chapter); setTargetBookId(''); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg" title="Déplacer"><ChevronRight className="w-4 h-4" /></button>
                    <button onClick={() => { setRenamingChapter(chapter); setNewName(chapter.title || ''); }} className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg" title="Renommer"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setDeletingChapter(chapter)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {movingChapter && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Déplacer le chapitre</h3>
            <p className="text-sm text-gray-600 mb-4">Tu es sur le point de déplacer le chapitre "{movingChapter.title}" ({getBlockCount(movingChapter.id)} blocs).</p>
            <div className="space-y-4 mb-6">
              <select value={targetBookId} onChange={e => setTargetBookId(e.target.value)} className="w-full p-3 border rounded-xl">
                <option value="">Sélectionner un livre cible</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setMovingChapter(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleMove} disabled={!targetBookId || actionLoading} className="flex-1 py-2 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {renamingChapter && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Renommer le chapitre</h3>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-3 border rounded-xl mb-6" placeholder="Nouveau nom" />
            <div className="flex gap-3">
              <button onClick={() => setRenamingChapter(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleRename} disabled={!newName.trim() || actionLoading} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {deletingChapter && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-red-600">Supprimer le chapitre</h3>
            <p className="text-sm text-gray-600 mb-6">Tu es sur le point de supprimer le chapitre "{deletingChapter.title}" et ses {getBlockCount(deletingChapter.id)} blocs. Cette action est irréversible. Continuer ?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingChapter(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleDelete} disabled={actionLoading} className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold disabled:opacity-50">Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {merging && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Fusionner {selectedChapters.length} chapitres</h3>
            <p className="text-sm text-gray-600 mb-4">Tu es sur le point de fusionner {selectedChapters.length} chapitres (total de {selectedChapters.reduce((acc, id) => acc + getBlockCount(id), 0)} blocs). Sélectionne le chapitre cible qui recevra tous les blocs. Les autres chapitres seront supprimés.</p>
            <div className="space-y-4 mb-6">
              <select value={targetChapterId} onChange={e => setTargetChapterId(e.target.value)} className="w-full p-3 border rounded-xl">
                <option value="">Sélectionner le chapitre cible</option>
                {selectedChapters.map(id => {
                  const c = chapters.find(ch => ch.id === id);
                  return c ? <option key={c.id} value={c.id}>{c.title} ({getBookName(c.bookId)})</option> : null;
                })}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setMerging(false)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleMerge} disabled={!targetChapterId || actionLoading} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MaintenanceBooksTab() {
  const [books, setBooks] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedBooks, setSelectedBooks] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // Modals
  const [renamingBook, setRenamingBook] = useState<any>(null);
  const [merging, setMerging] = useState(false);
  const [deletingBook, setDeletingBook] = useState<any>(null);
  
  const [targetBookId, setTargetBookId] = useState('');
  const [newName, setNewName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [bSnap, cSnap, blSnap] = await Promise.all([
        getDocs(collection(db, 'books')),
        getDocs(collection(db, 'chapters')),
        getDocs(collection(db, 'blocks'))
      ]);
      setBooks(bSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setChapters(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBlocks(blSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getChapterCount = (bookId: string) => chapters.filter(c => c.bookId === bookId).length;

  const filteredBooks = books.filter(b => 
    (b.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleRename = async () => {
    if (!renamingBook || !newName.trim()) return;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'books', renamingBook.id), { name: newName.trim() });
      setRenamingBook(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors du renommage.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingBook) return;
    setActionLoading(true);
    try {
      // Delete book
      await deleteDoc(doc(db, 'books', deletingBook.id));
      
      const chaptersToDelete = chapters.filter(c => c.bookId === deletingBook.id);
      let batch = writeBatch(db);
      let count = 0;

      for (const c of chaptersToDelete) {
        // Delete chapter
        batch.delete(doc(db, 'chapters', c.id));
        count++;
        if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }

        // Delete blocks
        const blocksToDelete = blocks.filter(b => b.chapterId === c.id);
        for (const b of blocksToDelete) {
          batch.delete(doc(db, 'blocks', b.id));
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }

        // Delete questions
        const qSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', '==', c.id)));
        for (const qDoc of qSnap.docs) {
          batch.delete(qDoc.ref);
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
      }
      if (count > 0) await batch.commit();
      
      setDeletingBook(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la suppression.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMerge = async () => {
    if (selectedBooks.length < 2 || !targetBookId) return;
    setActionLoading(true);
    try {
      const sourceBooks = selectedBooks.filter(id => id !== targetBookId);
      
      let batch = writeBatch(db);
      let count = 0;

      for (const bookId of sourceBooks) {
        // Move chapters
        const chaptersToMove = chapters.filter(c => c.bookId === bookId);
        for (const c of chaptersToMove) {
          batch.update(doc(db, 'chapters', c.id), { bookId: targetBookId });
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }

        // Delete source book
        batch.delete(doc(db, 'books', bookId));
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();

      setMerging(false);
      setSelectedBooks([]);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la fusion.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <input 
          type="text" 
          placeholder="Rechercher un livre..." 
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="p-3 bg-gray-50 border border-gray-200 rounded-xl w-64"
        />
        {selectedBooks.length > 1 && (
          <button 
            onClick={() => { setMerging(true); setTargetBookId(''); }}
            className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold flex items-center gap-2"
          >
            Fusionner ({selectedBooks.length})
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="p-4 w-12">
                  <button onClick={() => setSelectedBooks(selectedBooks.length === filteredBooks.length ? [] : filteredBooks.map(b => b.id))}>
                    {selectedBooks.length === filteredBooks.length && filteredBooks.length > 0 ? <CheckSquare className="w-5 h-5 text-amber-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                  </button>
                </th>
                <th className="p-4 font-bold text-gray-600">Nom du livre</th>
                <th className="p-4 font-bold text-gray-600">Chapitres</th>
                <th className="p-4 font-bold text-gray-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredBooks.map(book => (
                <tr key={book.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4">
                    <button onClick={() => setSelectedBooks(prev => prev.includes(book.id) ? prev.filter(id => id !== book.id) : [...prev, book.id])}>
                      {selectedBooks.includes(book.id) ? <CheckSquare className="w-5 h-5 text-amber-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                    </button>
                  </td>
                  <td className="p-4 font-medium text-gray-900">{book.name || 'Sans nom'}</td>
                  <td className="p-4 text-gray-600">{getChapterCount(book.id)}</td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => { setRenamingBook(book); setNewName(book.name || ''); }} className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg" title="Renommer"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setDeletingBook(book)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {renamingBook && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Renommer le livre</h3>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-3 border rounded-xl mb-6" placeholder="Nouveau nom" />
            <div className="flex gap-3">
              <button onClick={() => setRenamingBook(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleRename} disabled={!newName.trim() || actionLoading} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {deletingBook && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-red-600">Supprimer le livre</h3>
            <p className="text-sm text-gray-600 mb-6">Tu es sur le point de supprimer le livre "{deletingBook.name}" et ses {getChapterCount(deletingBook.id)} chapitres. Cette action est irréversible. Continuer ?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingBook(null)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleDelete} disabled={actionLoading} className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold disabled:opacity-50">Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {merging && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Fusionner {selectedBooks.length} livres</h3>
            <p className="text-sm text-gray-600 mb-4">Tu es sur le point de fusionner {selectedBooks.length} livres (total de {selectedBooks.reduce((acc, id) => acc + getChapterCount(id), 0)} chapitres). Sélectionne le livre cible qui recevra tous les chapitres. Les autres livres seront supprimés.</p>
            <div className="space-y-4 mb-6">
              <select value={targetBookId} onChange={e => setTargetBookId(e.target.value)} className="w-full p-3 border rounded-xl">
                <option value="">Sélectionner le livre cible</option>
                {selectedBooks.map(id => {
                  const b = books.find(bk => bk.id === id);
                  return b ? <option key={b.id} value={b.id}>{b.name}</option> : null;
                })}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setMerging(false)} className="flex-1 py-2 bg-gray-100 rounded-xl font-bold">Annuler</button>
              <button onClick={handleMerge} disabled={!targetBookId || actionLoading} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-50">Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
