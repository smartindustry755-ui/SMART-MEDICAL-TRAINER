import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, serverTimestamp, where, limit } from 'firebase/firestore';
import { Plus, Trash2, Calendar, Clock, FileText, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const STANDARD_CHAPTERS = ["médecine interne", "pédiatrie", "chirurgie", "gynécologie-obstétrique", "santé publique"];

export default function AdminExamManager() {
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [chapterQuotas, setChapterQuotas] = useState<Record<string, number>>({
    "médecine interne": 10,
    "pédiatrie": 10,
    "chirurgie": 10,
    "gynécologie-obstétrique": 10,
    "santé publique": 10
  });
  const [selectedBooks, setSelectedBooks] = useState<string[]>([]);
  const [books, setBooks] = useState<any[]>([]);

  useEffect(() => {
    fetchExams();
    fetchBooks();
  }, []);

  const fetchExams = async () => {
    try {
      const q = query(collection(db, 'exams'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setExams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err: any) {
      console.error(err);
      setError("Erreur lors du chargement des examens.");
    } finally {
      setLoading(false);
    }
  };

  const fetchBooks = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'books'), orderBy('name', 'asc')));
      setBooks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalRequested: number = (Object.values(chapterQuotas) as number[]).reduce((a, b) => a + b, 0);
    
    if (!title || !startTime || durationMinutes <= 0 || totalRequested <= 0 || selectedBooks.length === 0) {
      setError("Veuillez remplir tous les champs correctement et demander au moins une question.");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // 1. Fetch chapters for selected books to map chapterId -> title
      let allChapters: any[] = [];
      for (const bookId of selectedBooks) {
        const cSnap = await getDocs(query(collection(db, 'chapters'), where('bookId', '==', bookId)));
        allChapters = [...allChapters, ...cSnap.docs.map(d => ({ id: d.id, ...d.data() }))];
      }
      
      const chapterIdToTitle = allChapters.reduce((acc, c) => {
        acc[c.id] = (c.title || '').toLowerCase();
        return acc;
      }, {} as Record<string, string>);

      const chapterIds = Object.keys(chapterIdToTitle);
      if (chapterIds.length === 0) {
        setError("Aucun chapitre trouvé dans les livres sélectionnés.");
        setCreating(false);
        return;
      }

      // 2. Fetch questions for these chapters
      let allQuestions: any[] = [];
      const chunkSize = 10;
      for (let i = 0; i < chapterIds.length; i += chunkSize) {
        const chunk = chapterIds.slice(i, i + chunkSize);
        const qSnap = await getDocs(query(collection(db, 'questions'), where('chapterId', 'in', chunk)));
        allQuestions = [...allQuestions, ...qSnap.docs.map(d => ({ id: d.id, ...d.data() }))];
      }

      if (allQuestions.length === 0) {
        setError("Aucune question trouvée dans les livres sélectionnés.");
        setCreating(false);
        return;
      }

      // 3. Group questions by normalized chapter title
      const questionsByChapter: Record<string, any[]> = {};
      allQuestions.forEach(q => {
        const title = chapterIdToTitle[q.chapterId];
        if (title) {
          if (!questionsByChapter[title]) questionsByChapter[title] = [];
          questionsByChapter[title].push(q);
        }
      });

      // 4. Pick questions according to quotas
      let selectedQuestionIds: string[] = [];
      for (const [chapterTitle, quota] of Object.entries(chapterQuotas) as [string, number][]) {
        if (quota <= 0) continue;
        const normalizedTitle = chapterTitle.toLowerCase();
        const available = questionsByChapter[normalizedTitle] || [];
        
        if (available.length < quota) {
          setError(`Pas assez de questions pour le chapitre "${chapterTitle}" (Demandé: ${quota}, Disponible: ${available.length}).`);
          setCreating(false);
          return;
        }
        
        const shuffled = available.sort(() => 0.5 - Math.random());
        selectedQuestionIds = [...selectedQuestionIds, ...shuffled.slice(0, quota).map(q => q.id)];
      }

      // 5. Final shuffle of the selected questions
      selectedQuestionIds = selectedQuestionIds.sort(() => 0.5 - Math.random());

      await addDoc(collection(db, 'exams'), {
        title,
        startTime: new Date(startTime).toISOString(),
        durationMinutes,
        questionIds: selectedQuestionIds,
        createdAt: serverTimestamp()
      });

      setTitle('');
      setStartTime('');
      setDurationMinutes(60);
      setChapterQuotas({
        "médecine interne": 10,
        "pédiatrie": 10,
        "chirurgie": 10,
        "gynécologie-obstétrique": 10,
        "santé publique": 10
      });
      setSelectedBooks([]);
      
      fetchExams();
    } catch (err: any) {
      console.error(err);
      setError("Erreur lors de la création de l'examen.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cet examen ?")) return;
    try {
      await deleteDoc(doc(db, 'exams', id));
      fetchExams();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la suppression.");
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <Plus className="w-5 h-5 text-blue-600" />
          Créer un Examen Blanc
        </h2>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleCreateExam} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Titre de l'examen</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Ex: Examen Blanc National 2026"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date et Heure de début</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Durée (minutes)</label>
              <input
                type="number"
                min="1"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-4">Nombre de questions par chapitre</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
              {STANDARD_CHAPTERS.map(chapter => (
                <div key={chapter}>
                  <label className="block text-xs font-medium text-gray-600 mb-1 capitalize">{chapter}</label>
                  <input
                    type="number"
                    min="0"
                    value={chapterQuotas[chapter] || 0}
                    onChange={(e) => setChapterQuotas({ ...chapterQuotas, [chapter]: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              ))}
              <div className="flex flex-col justify-end">
                <div className="px-4 py-2 bg-blue-100 text-blue-800 rounded-lg font-bold text-center border border-blue-200">
                  Total : {(Object.values(chapterQuotas) as number[]).reduce((a, b) => a + b, 0)} questions
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Livres sources (tirage aléatoire)</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {books.map(book => (
                <label key={book.id} className="flex items-center gap-2 p-3 border rounded-xl cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedBooks.includes(book.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedBooks([...selectedBooks, book.id]);
                      else setSelectedBooks(selectedBooks.filter(id => id !== book.id));
                    }}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">{book.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="px-6 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              Créer l'examen
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Examens Programmés
        </h2>

        {exams.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Aucun examen programmé.</p>
        ) : (
          <div className="space-y-4">
            {exams.map(exam => (
              <div key={exam.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                <div>
                  <h3 className="font-bold text-gray-900">{exam.title}</h3>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                    <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> {new Date(exam.startTime).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {exam.durationMinutes} min</span>
                    <span className="flex items-center gap-1"><FileText className="w-4 h-4" /> {exam.questionIds?.length || 0} questions</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(exam.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Supprimer"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
