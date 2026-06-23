import React, { useState, useEffect } from 'react';
import { db, storage, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  writeBatch, 
  doc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  orderBy, 
  onSnapshot,
  limit,
  increment
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { 
  Settings, 
  Search, 
  Edit2, 
  Trash2, 
  Move, 
  ChevronRight, 
  Loader2, 
  Book as BookIcon, 
  FileText, 
  LayoutGrid,
  AlertCircle,
  X
} from 'lucide-react';
import { cn } from '../lib/utils';

interface Book {
  id: string;
  name: string;
  type: string;
}

interface Chapter {
  id: string;
  title: string;
  bookId: string;
}

interface Block {
  id: string;
  blockTitle: string;
  chapterId: string;
  questionsCount?: number;
}

export default function SettingsView() {
  const [books, setBooks] = useState<Book[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'books' | 'chapters' | 'blocks' | 'questions' | 'answers'>('books');

  // Modals state
  const [editingItem, setEditingItem] = useState<{ type: 'book' | 'chapter' | 'block' | 'question' | 'answer', item: any } | null>(null);
  const [movingItem, setMovingItem] = useState<{ type: 'chapter' | 'block', item: any } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'book' | 'chapter' | 'block' | 'question' | 'answer', item: any } | null>(null);
  
  const [editValue, setEditValue] = useState('');
  const [questionEditData, setQuestionEditData] = useState<any>(null);
  const [answerEditData, setAnswerEditData] = useState<any>(null);
  const [targetId, setTargetId] = useState('');
  const [targetParentId, setTargetParentId] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    // Real-time listeners for books, chapters, blocks
    const unsubBooks = onSnapshot(collection(db, 'books'), (snap) => {
      setBooks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Book)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'books');
    });

    const unsubChapters = onSnapshot(collection(db, 'chapters'), (snap) => {
      setChapters(snap.docs.map(d => ({ id: d.id, ...d.data() } as Chapter)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'chapters');
    });

    const unsubBlocks = onSnapshot(collection(db, 'blocks'), (snap) => {
      setBlocks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Block)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'blocks');
      setLoading(false);
    });

    return () => {
      unsubBooks();
      unsubChapters();
      unsubBlocks();
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'questions') {
      const fetchQuestions = async () => {
        setLoading(true);
        const searchLower = searchQuery.toLowerCase().trim();
        try {
          let q;
          if (searchQuery.trim()) {
            q = query(
              collection(db, 'questions'), 
              orderBy('text'), 
              where('text', '>=', searchQuery), 
              where('text', '<=', searchQuery + '\uf8ff'),
              limit(50)
            );
          } else {
            q = query(collection(db, 'questions'), orderBy('number', 'asc'), limit(50));
          }
          const snap = await getDocs(q);
          let fetchedQs = snap.docs.map(d => ({ id: d.id, ... (d.data() as any) }));
          
          if (fetchedQs.length === 0 && searchQuery.trim()) {
            const broadQuery = query(collection(db, 'questions'), limit(200));
            const broadSnap = await getDocs(broadQuery);
            fetchedQs = broadSnap.docs
              .map(d => ({ id: d.id, ...d.data() as any }))
              .filter(q => 
                q.text.toLowerCase().includes(searchLower) || 
                (q.number && q.number.toString() === searchQuery)
              )
              .slice(0, 50);
          }
          setQuestions(fetchedQs);
        } catch (err) {
          console.error(err);
          if (searchQuery.trim()) {
            try {
              const broadQuery = query(collection(db, 'questions'), limit(200));
              const broadSnap = await getDocs(broadQuery);
              const filtered = broadSnap.docs
                .map(d => ({ id: d.id, ...d.data() as any }))
                .filter((q: any) => q.text.toLowerCase().includes(searchLower))
                .slice(0, 50);
              setQuestions(filtered);
            } catch (e) {}
          }
        } finally {
          setLoading(false);
        }
      };

      const timer = setTimeout(fetchQuestions, 500);
      return () => clearTimeout(timer);
    } else if (activeTab === 'answers') {
      const fetchAnswers = async () => {
        setLoading(true);
        const searchLower = searchQuery.toLowerCase().trim();
        try {
          // Answers don't have many searchable fields besides questionId or explanation (which can be huge)
          // We'll fetch a batch and rely on local filtering or questionId search
          let q = query(collection(db, 'answers'), limit(50));
          const snap = await getDocs(q);
          let fetchedAs = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
          
          if (searchLower) {
            fetchedAs = fetchedAs.filter(a => 
              a.questionId?.toLowerCase().includes(searchLower) ||
              a.explanation?.toLowerCase().includes(searchLower)
            );
          }
          setAnswers(fetchedAs);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      const timer = setTimeout(fetchAnswers, 500);
      return () => clearTimeout(timer);
    }
  }, [activeTab, searchQuery]);

  const filteredBooks = books.filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredChapters = chapters.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredBlocks = blocks.filter(b => (b.blockTitle || '').toLowerCase().includes(searchQuery.toLowerCase()));

  const handleEdit = async () => {
    if (!editingItem) return;
    if (editingItem.type !== 'question' && editingItem.type !== 'answer' && !editValue.trim()) return;
    setOperationLoading(true);
    try {
      if (editingItem.type === 'question') {
        const { text, options, correctLetter, explanation } = questionEditData;
        const batch = writeBatch(db);
        
        // Update Question
        batch.update(doc(db, 'questions', editingItem.item.id), {
          text,
          options
        });

        // Update Answer
        const aSnap = await getDocs(query(collection(db, 'answers'), where('questionId', '==', editingItem.item.id)));
        if (!aSnap.empty) {
          batch.update(aSnap.docs[0].ref, {
            correctLetter,
            explanation
          });
        } else {
          // Create answer if missing
          const newAnswerRef = doc(collection(db, 'answers'));
          batch.set(newAnswerRef, {
            questionId: editingItem.item.id,
            correctLetter,
            explanation
          });
        }
        
        await batch.commit();

        // Update local state
        setQuestions(prev => prev.map(q => q.id === editingItem.item.id ? { ...q, text, options } : q));
      } else if (editingItem.type === 'answer') {
        const { correctLetter, explanation } = answerEditData;
        await updateDoc(doc(db, 'answers', editingItem.item.id), {
          correctLetter,
          explanation
        });
        setAnswers(prev => prev.map(a => a.id === editingItem.item.id ? { ...a, correctLetter, explanation } : a));
      } else {
        const collectionName = editingItem.type === 'book' ? 'books' : editingItem.type === 'chapter' ? 'chapters' : 'blocks';
        const fieldName = editingItem.type === 'block' ? 'blockTitle' : editingItem.type === 'book' ? 'name' : 'title';
        
        await updateDoc(doc(db, collectionName, editingItem.item.id), {
          [fieldName]: editValue.trim()
        });
      }
      setEditingItem(null);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la modification");
    } finally {
      setOperationLoading(false);
    }
  };

  const handleMove = async () => {
    if (!movingItem || !targetId) return;
    setOperationLoading(true);
    try {
      let batch = writeBatch(db);
      if (movingItem.type === 'chapter') {
        batch.update(doc(db, 'chapters', movingItem.item.id), {
          bookId: targetId
        });
        // Update all questions in this chapter
        const qSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', '==', movingItem.item.id)));
        let count = 1; // start at 1 because we already added chapter update
        for (const qDoc of qSnap.docs) {
          batch.update(qDoc.ref, { bookId: targetId });
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        if (count > 0) await batch.commit();
      } else if (movingItem.type === 'block') {
        const targetChapter = chapters.find(c => c.id === targetId);
        if (!targetChapter) throw new Error("Chapitre de destination introuvable");

        batch.update(doc(db, 'blocks', movingItem.item.id), {
          chapterId: targetId
        });
        // Update all questions in this block
        const qSnap = await getDocs(query(collection(db, 'questions'), where('blockId', '==', movingItem.item.id)));
        let count = 1; 
        for (const qDoc of qSnap.docs) {
          batch.update(qDoc.ref, { 
            chapterId: targetId,
            bookId: targetChapter.bookId
          });
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        if (count > 0) await batch.commit();
      }
      setMovingItem(null);
      setTargetId('');
      setTargetParentId('');
    } catch (err) {
      console.error(err);
      alert("Erreur lors du déplacement");
    } finally {
      setOperationLoading(false);
    }
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
        if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
      }
      batch.delete(qDoc.ref);
      count++;
      if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
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
      if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }

    batch.delete(doc(db, 'chapters', chapterId));
    await batch.commit();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setOperationLoading(true);
    try {
      if (confirmDelete.type === 'book') {
        const cSnap = await getDocs(query(collection(db, 'chapters'), where('bookId', '==', confirmDelete.item.id)));
        for (const cDoc of cSnap.docs) {
          await deleteChapterData(cDoc.id);
        }
        await deleteDoc(doc(db, 'books', confirmDelete.item.id));
      } else if (confirmDelete.type === 'chapter') {
        await deleteChapterData(confirmDelete.item.id);
      } else if (confirmDelete.type === 'block') {
        // Delete block and its questions
        const qSnap = await getDocs(query(collection(db, 'questions'), where('blockId', '==', confirmDelete.item.id)));
        let batch = writeBatch(db);
        let count = 0;
        for (const qDoc of qSnap.docs) {
          const aSnap = await getDocs(query(collection(db, 'answers'), where('questionId', '==', qDoc.id)));
          for (const aDoc of aSnap.docs) {
            batch.delete(aDoc.ref);
            count++;
            if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
          }
          batch.delete(qDoc.ref);
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        batch.delete(doc(db, 'blocks', confirmDelete.item.id));
        await batch.commit();
      } else if (confirmDelete.type === 'question') {
        const aSnap = await getDocs(query(collection(db, 'answers'), where('questionId', '==', confirmDelete.item.id)));
        const batch = writeBatch(db);
        aSnap.docs.forEach(d => batch.delete(d.ref));
        
        // Delete images if any
        const qData = confirmDelete.item;
        if (qData.imageUrls) {
          for (const url of qData.imageUrls) {
            try { await deleteObject(ref(storage, url)); } catch (e) {}
          }
        }
        
        batch.delete(doc(db, 'questions', confirmDelete.item.id));
        
        // Decrement questionsCount in block
        if (confirmDelete.item.blockId) {
          batch.update(doc(db, 'blocks', confirmDelete.item.blockId), {
            questionsCount: increment(-1)
          });
        }
        
        await batch.commit();
        setQuestions(prev => prev.filter(q => q.id !== confirmDelete.item.id));
      } else if (confirmDelete.type === 'answer') {
        await deleteDoc(doc(db, 'answers', confirmDelete.item.id));
        setAnswers(prev => prev.filter(a => a.id !== confirmDelete.item.id));
      }
      setConfirmDelete(null);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la suppression");
    } finally {
      setOperationLoading(false);
    }
  };

  const openQuestionEdit = async (question: any) => {
    setOperationLoading(true);
    try {
      const aSnap = await getDocs(query(collection(db, 'answers'), where('questionId', '==', question.id)));
      const answerData = aSnap.empty ? { correctLetter: '', explanation: '' } : aSnap.docs[0].data();
      
      setQuestionEditData({
        text: question.text,
        options: question.options || [],
        correctLetter: answerData.correctLetter,
        explanation: answerData.explanation
      });
      setEditingItem({ type: 'question', item: question });
    } catch (err) {
      console.error(err);
      alert("Erreur lors du chargement des données de la question");
    } finally {
      setOperationLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2rem] p-6 md:p-8 border border-gray-200/60 shadow-xl shadow-blue-900/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl"><Settings className="w-6 h-6 text-blue-600" /></div>
            <h3 className="text-2xl font-display font-bold text-gray-900">Paramètres du Contenu</h3>
          </div>
          
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input 
              type="text"
              placeholder="Rechercher un livre, chapitre ou bloc..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="flex gap-2 p-1 bg-gray-100 rounded-2xl mb-8 w-fit">
          <button 
            onClick={() => setActiveTab('books')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold text-sm transition-all",
              activeTab === 'books' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Livres ({filteredBooks.length})
          </button>
          <button 
            onClick={() => setActiveTab('chapters')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold text-sm transition-all",
              activeTab === 'chapters' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Chapitres ({filteredChapters.length})
          </button>
          <button 
            onClick={() => setActiveTab('blocks')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold text-sm transition-all",
              activeTab === 'blocks' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Blocs ({filteredBlocks.length})
          </button>
          <button 
            onClick={() => setActiveTab('questions')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold text-sm transition-all",
              activeTab === 'questions' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Questions
          </button>
          <button 
            onClick={() => setActiveTab('answers')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold text-sm transition-all",
              activeTab === 'answers' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Réponses
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            <p className="text-gray-500 font-medium">Chargement des données...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activeTab === 'books' && filteredBooks.map(book => (
              <div key={book.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-blue-200 transition-all">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-white rounded-xl shadow-sm"><BookIcon className="w-5 h-5 text-blue-600" /></div>
                  <div>
                    <p className="font-bold text-gray-900">{book.name}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{book.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => { setEditingItem({ type: 'book', item: book }); setEditValue(book.name); }}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setConfirmDelete({ type: 'book', item: book })}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}

            {activeTab === 'chapters' && filteredChapters.map(chapter => (
              <div key={chapter.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-blue-200 transition-all">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-white rounded-xl shadow-sm"><FileText className="w-5 h-5 text-emerald-600" /></div>
                  <div>
                    <p className="font-bold text-gray-900">{chapter.title}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Livre: {books.find(b => b.id === chapter.bookId)?.name || 'Inconnu'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => { setEditingItem({ type: 'chapter', item: chapter }); setEditValue(chapter.title); }}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => { setMovingItem({ type: 'chapter', item: chapter }); setTargetId(chapter.bookId); }}
                    className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                  >
                    <Move className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setConfirmDelete({ type: 'chapter', item: chapter })}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}

            {activeTab === 'blocks' && filteredBlocks.map(block => (
              <div key={block.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-blue-200 transition-all">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-white rounded-xl shadow-sm"><LayoutGrid className="w-5 h-5 text-purple-600" /></div>
                  <div>
                    <p className="font-bold text-gray-900">{block.blockTitle || "Bloc sans nom"}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Chapitre: {chapters.find(c => c.id === block.chapterId)?.title || 'Inconnu'} • {block.questionsCount || 0} questions
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => { setEditingItem({ type: 'block', item: block }); setEditValue(block.blockTitle || ''); }}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => { 
                      setMovingItem({ type: 'block', item: block }); 
                      const ch = chapters.find(c => c.id === block.chapterId);
                      setTargetParentId(ch?.bookId || '');
                      setTargetId(block.chapterId); 
                    }}
                    className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                  >
                    <Move className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setConfirmDelete({ type: 'block', item: block })}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}

            {activeTab === 'questions' && questions.map(question => (
              <div key={question.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-blue-200 transition-all">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="p-2.5 bg-white rounded-xl shadow-sm h-fit"><FileText className="w-5 h-5 text-indigo-600" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900 truncate">Q{question.number}: {question.text}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">
                      Chapitre: {chapters.find(c => c.id === question.chapterId)?.title || 'Inconnu'} • 
                      Bloc: {blocks.find(b => b.id === question.blockId)?.blockTitle || 'Inconnu'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button 
                    onClick={() => openQuestionEdit(question)}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setConfirmDelete({ type: 'question', item: question })}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}

            {activeTab === 'answers' && answers.map(answer => (
              <div key={answer.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-blue-200 transition-all">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="p-2.5 bg-white rounded-xl shadow-sm h-fit"><AlertCircle className="w-5 h-5 text-amber-600" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900 truncate">Réponse pour QID: {answer.questionId}</p>
                    <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest truncate">Correction: {answer.correctLetter}</p>
                    <p className="text-xs text-gray-500 truncate italic">{answer.explanation || "Sans explication"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button 
                    onClick={() => {
                      setAnswerEditData({ correctLetter: answer.correctLetter, explanation: answer.explanation });
                      setEditingItem({ type: 'answer', item: answer });
                    }}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setConfirmDelete({ type: 'answer', item: answer })}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}

            {((activeTab === 'books' && filteredBooks.length === 0) ||
              (activeTab === 'chapters' && filteredChapters.length === 0) ||
              (activeTab === 'blocks' && filteredBlocks.length === 0) ||
              (activeTab === 'questions' && questions.length === 0) ||
              (activeTab === 'answers' && answers.length === 0)) && (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
                <p className="text-gray-400 font-medium">Aucun résultat trouvé pour "{searchQuery}"</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className={cn(
            "bg-white rounded-[2rem] p-6 md:p-8 w-full shadow-2xl border border-gray-200 transition-all my-8",
            editingItem.type === 'question' ? "max-w-3xl" : "max-w-md"
          )}>
            <h3 className="text-2xl font-display font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-xl"><Edit2 className="w-6 h-6 text-blue-600" /></div>
              Modifier {
                editingItem.type === 'book' ? 'le livre' : 
                editingItem.type === 'chapter' ? 'le chapitre' : 
                editingItem.type === 'block' ? 'le bloc' : 
                editingItem.type === 'question' ? 'la question' : 'la réponse'
              }
            </h3>
            
            <div className="space-y-6">
              {editingItem.type === 'question' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Texte de la question</label>
                    <textarea 
                      value={questionEditData.text}
                      onChange={(e) => setQuestionEditData({ ...questionEditData, text: e.target.value })}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-[100px]"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {questionEditData.options.map((opt: any, idx: number) => (
                      <div key={idx}>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-widest">Option {opt.letter}</label>
                        <input 
                          type="text" 
                          value={opt.text}
                          onChange={(e) => {
                            const newOpts = [...questionEditData.options];
                            newOpts[idx] = { ...newOpts[idx], text: e.target.value };
                            setQuestionEditData({ ...questionEditData, options: newOpts });
                          }}
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Lettre Correcte</label>
                      <input 
                        type="text" 
                        maxLength={1}
                        value={questionEditData.correctLetter}
                        onChange={(e) => setQuestionEditData({ ...questionEditData, correctLetter: e.target.value.toUpperCase() })}
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-center font-bold"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Explication</label>
                    <textarea 
                      value={questionEditData.explanation}
                      onChange={(e) => setQuestionEditData({ ...questionEditData, explanation: e.target.value })}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-[150px]"
                    />
                  </div>
                </div>
              ) : editingItem.type === 'answer' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Lettre Correcte</label>
                    <input 
                      type="text" 
                      maxLength={1}
                      value={answerEditData.correctLetter}
                      onChange={(e) => setAnswerEditData({ ...answerEditData, correctLetter: e.target.value.toUpperCase() })}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-center font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Explication</label>
                    <textarea 
                      value={answerEditData.explanation}
                      onChange={(e) => setAnswerEditData({ ...answerEditData, explanation: e.target.value })}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-[150px]"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Nouveau titre</label>
                  <input 
                    type="text" 
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    autoFocus
                  />
                </div>
              )}
              
              <div className="flex gap-4 pt-2">
                <button 
                  onClick={() => setEditingItem(null)}
                  className="flex-1 px-6 py-4 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleEdit}
                  disabled={operationLoading}
                  className="flex-1 px-6 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 disabled:opacity-50 flex items-center justify-center"
                >
                  {operationLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sauvegarder"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {movingItem && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-200">
            <h3 className="text-2xl font-display font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div className="p-2 bg-emerald-50 rounded-xl"><Move className="w-6 h-6 text-emerald-600" /></div>
              Déplacer {movingItem.type === 'chapter' ? 'le chapitre' : 'le bloc'}
            </h3>
            <div className="space-y-6">
              {movingItem.type === 'chapter' ? (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Livre de destination</label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                  >
                    <option value="">Sélectionner un livre</option>
                    {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Livre</label>
                    <select
                      value={targetParentId}
                      onChange={(e) => { setTargetParentId(e.target.value); setTargetId(''); }}
                      className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    >
                      <option value="">Sélectionner un livre</option>
                      {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  {targetParentId && (
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Chapitre de destination</label>
                      <select
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      >
                        <option value="">Sélectionner un chapitre</option>
                        {chapters.filter(c => c.bookId === targetParentId).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-4 pt-2">
                <button 
                  onClick={() => setMovingItem(null)}
                  className="flex-1 px-6 py-4 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleMove}
                  disabled={operationLoading || !targetId}
                  className="flex-1 px-6 py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200 disabled:opacity-50 flex items-center justify-center"
                >
                  {operationLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Déplacer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-200">
            <div className="flex items-center gap-4 text-red-600 mb-6">
              <div className="p-3 bg-red-50 rounded-2xl"><AlertCircle className="w-8 h-8" /></div>
              <h3 className="text-2xl font-display font-bold">Suppression Définitive</h3>
            </div>
            <p className="text-gray-600 mb-8 leading-relaxed">
              Êtes-vous sûr de vouloir supprimer {confirmDelete.type === 'book' ? 'le livre' : confirmDelete.type === 'chapter' ? 'le chapitre' : confirmDelete.type === 'block' ? 'le bloc' : confirmDelete.type === 'question' ? 'la question' : 'la réponse'} <span className="font-bold text-gray-900">"{confirmDelete.type === 'book' ? confirmDelete.item.name : confirmDelete.type === 'chapter' ? confirmDelete.item.title : confirmDelete.type === 'block' ? confirmDelete.item.blockTitle : confirmDelete.type === 'question' ? `Q${confirmDelete.item.number}` : `Rép pour ${confirmDelete.item.questionId}`}"</span> ?
              <br /><br />
              <span className="text-red-600 font-bold text-sm uppercase tracking-wider">Attention :</span> Cette action supprimera également toutes les données associées. Cette opération est irréversible.
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-6 py-4 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button 
                onClick={handleDelete}
                disabled={operationLoading}
                className="flex-1 px-6 py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-colors shadow-lg shadow-red-200 disabled:opacity-50 flex items-center justify-center"
              >
                {operationLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
