import React, { useState } from 'react';
import { db, storage, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, deleteDoc, orderBy, onSnapshot } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { Trash2, ChevronDown, ChevronUp, Loader2, Book, LayoutGrid, Settings } from 'lucide-react';

const Gallery = ({ books, setStatus, loading }: { books: any[], setStatus: (status: { type: 'success' | 'error', message: string } | null) => void, loading: boolean }) => {
  const [chapters, setChapters] = useState<Record<string, any[]>>({});
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});
  const [operationLoading, setOperationLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const fetchChapters = async (bookId: string) => {
    try {
      const snap = await getDocs(query(collection(db, 'chapters'), where('bookId', '==', bookId), orderBy('title', 'asc')));
      setChapters(prev => ({ ...prev, [bookId]: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    } catch (err) {
      console.error(err);
    }
  };

  const toggleBook = (bookId: string) => {
    if (!expandedBooks[bookId]) {
      fetchChapters(bookId);
    }
    setExpandedBooks(prev => ({ ...prev, [bookId]: !prev[bookId] }));
  };

  const deleteChapterData = async (chapterId: string) => {
    const qSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', '==', chapterId)));
    let batch = writeBatch(db);
    let count = 0;

    for (const qDoc of qSnap.docs) {
      const aSnap = await getDocs(query(collection(db, 'answers'), where('questionId', '==', qDoc.id)));
      for (const aDoc of aSnap.docs) {
        batch.delete(aDoc.ref);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      batch.delete(qDoc.ref);
      count++;
      if (count >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
      const qData = qDoc.data();
      if (qData.imageUrls) {
        for (const url of qData.imageUrls) {
          try { await deleteObject(ref(storage, url)); } catch (e) {}
        }
      }
    }

    const bSnap = await getDocs(query(collection(db, 'blocks'), where('chapterId', '==', chapterId)));
    for (const bDoc of bSnap.docs) {
      batch.delete(bDoc.ref);
      count++;
      if (count >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }

    batch.delete(doc(db, 'chapters', chapterId));
    await batch.commit();
  };

  const handleRenameChapter = async (chapter: any) => {
    if (!editingTitle.trim() || editingTitle === chapter.title) {
      setEditingChapterId(null);
      return;
    }

    setOperationLoading(true);
    try {
      const { updateDoc, doc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'chapters', chapter.id), {
        title: editingTitle.trim()
      });
      fetchChapters(chapter.bookId);
      setEditingChapterId(null);
      setStatus({ type: 'success', message: "Chapitre renommé avec succès." });
      setTimeout(() => setStatus(null), 3000);
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors du renommage: " + err.message });
      setTimeout(() => setStatus(null), 5000);
    } finally {
      setOperationLoading(false);
    }
  };

  const handleDeleteChapter = (chapter: any) => {
    setConfirmDialog({
      isOpen: true,
      title: "Supprimer le chapitre",
      message: `Êtes-vous sûr de vouloir supprimer le chapitre "${chapter.title}" ? Toutes les questions et réponses associées seront supprimées.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setOperationLoading(true);
        try {
          await deleteChapterData(chapter.id);
          fetchChapters(chapter.bookId);
          setStatus({ type: 'success', message: "Chapitre supprimé avec succès." });
          setTimeout(() => setStatus(null), 3000);
        } catch (err: any) {
          console.error(err);
          setStatus({ type: 'error', message: "Erreur lors de la suppression: " + err.message });
          setTimeout(() => setStatus(null), 5000);
        } finally {
          setOperationLoading(false);
        }
      }
    });
  };

  const handleDeleteBook = (book: any) => {
    setConfirmDialog({
      isOpen: true,
      title: "Supprimer le livre",
      message: `Êtes-vous sûr de vouloir supprimer le livre "${book.name}" ? Tous les chapitres et données associés seront supprimés.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setOperationLoading(true);
        try {
          const cSnap = await getDocs(query(collection(db, 'chapters'), where('bookId', '==', book.id)));
          for (const cDoc of cSnap.docs) {
            await deleteChapterData(cDoc.id);
          }
          await deleteDoc(doc(db, 'books', book.id));
          setStatus({ type: 'success', message: "Livre supprimé avec succès." });
          setTimeout(() => setStatus(null), 3000);
        } catch (err: any) {
          console.error(err);
          setStatus({ type: 'error', message: "Erreur lors de la suppression: " + err.message });
          setTimeout(() => setStatus(null), 5000);
        } finally {
          setOperationLoading(false);
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
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
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-display font-bold text-gray-900">Galerie des Contenus</h2>
        <div className="flex items-center gap-4">
          {(loading || operationLoading) && <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />}
        </div>
      </div>

      {loading && books.length === 0 && <div className="text-center py-16 text-gray-500 bg-white rounded-3xl border border-gray-200/60 flex flex-col items-center justify-center gap-3"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /><p className="font-medium">Chargement des données...</p></div>}
      {operationLoading && <div className="fixed bottom-8 right-8 bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-gray-200/60 z-50 flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
        <span className="font-semibold text-gray-800">Opération en cours...</span>
      </div>}

      <div className="grid grid-cols-1 gap-5">
        {books.map(book => (
          <div key={book.id} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm hover:shadow-md transition-all overflow-hidden">
            <div className="p-5 flex items-center justify-between bg-gray-50/50 border-b border-gray-100">
              <button 
                onClick={() => toggleBook(book.id)}
                className="flex items-center gap-4 flex-1 text-left group"
              >
                <div className="p-2 bg-white rounded-xl shadow-sm border border-gray-200 group-hover:border-blue-300 transition-colors">
                  {expandedBooks[book.id] ? <ChevronUp className="w-5 h-5 text-blue-600" /> : <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-blue-600" />}
                </div>
                <div>
                  <h3 className="font-display font-bold text-xl text-gray-900 group-hover:text-blue-700 transition-colors">{book.name}</h3>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-700 bg-blue-100/50 px-2.5 py-1 rounded-full border border-blue-200/50">{book.type}</span>
                </div>
              </button>
              <button 
                onClick={() => handleDeleteBook(book)}
                className="p-2.5 text-red-500 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors border border-transparent hover:border-red-100"
                title="Supprimer le livre"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            {expandedBooks[book.id] && (
              <div className="p-5 space-y-3 bg-white">
                {chapters[book.id]?.map(chapter => (
                  <div key={chapter.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                    <div className="flex items-center gap-3 flex-1">
                      <Book className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                      {editingChapterId === chapter.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className="flex-1 p-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameChapter(chapter);
                              if (e.key === 'Escape') setEditingChapterId(null);
                            }}
                          />
                          <button
                            onClick={() => handleRenameChapter(chapter)}
                            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm font-bold"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => setEditingChapterId(null)}
                            className="px-3 py-1 bg-gray-200 text-gray-600 rounded-lg text-sm font-bold"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <span 
                          className="font-semibold text-gray-700 group-hover:text-gray-900 cursor-pointer"
                          onClick={() => {
                            setEditingChapterId(chapter.id);
                            setEditingTitle(chapter.title);
                          }}
                        >
                          {chapter.title}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          setEditingChapterId(chapter.id);
                          setEditingTitle(chapter.title);
                        }}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Renommer le chapitre"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteChapter(chapter)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-50 group-hover:opacity-100"
                        title="Supprimer le chapitre"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {chapters[book.id]?.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-8 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                    <p className="font-medium">Aucun chapitre dans ce livre.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {books.length === 0 && !loading && (
          <div className="text-center py-24 text-gray-400 border-2 border-dashed border-gray-200 rounded-3xl bg-white/50 backdrop-blur-sm">
            <LayoutGrid className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="font-medium text-lg">Aucun contenu enregistré dans la base.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Gallery;
