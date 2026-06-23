import React, { useState, useEffect } from 'react';
import { db, auth, getDocs } from '../lib/firebase';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { Calendar, Clock, FileText, ChevronRight, Trophy, AlertCircle, Loader2, ArrowLeft, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { safeLocalStorage } from '../lib/utils';

export default function UserExamList({ onSelectExam, onBack, filter = 'all', allowRecompose = false }: { 
  onSelectExam: (exam: any, attempt: any | null) => void, 
  onBack: () => void,
  filter?: 'finished' | 'all',
  allowRecompose?: boolean
}) {
  const [exams, setExams] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const savedUser = safeLocalStorage.getItem('ais_user');
  const user = savedUser ? JSON.parse(savedUser) : null;
  const userId = user?.username;

  useEffect(() => {
    fetchData();
  }, [userId]);

  const fetchData = async () => {
    if (!userId) return;
    try {
      const examsSnap = await getDocs(query(collection(db, 'exams'), orderBy('startTime', 'desc')));
      const examsData = examsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      
      const userFiliere = user?.filiere || 'ECN';
      const userNiveau = user?.niveau || 'ALL';

      const filteredExams = examsData.filter(e => {
        if (user?.role === 'admin') return true;
        const f = e.filiere || 'ECN';
        const n = e.niveau || 'ALL';
        return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
      });

      const attemptsSnap = await getDocs(query(collection(db, 'examAttempts'), where('userId', '==', userId)));
      const attemptsData = attemptsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      setExams(filteredExams);
      setAttempts(attemptsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 md:px-6">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour
      </button>

      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold mb-4">Examens Blancs</h1>
          <p className="text-blue-100 text-lg max-w-2xl">
            Testez vos connaissances en conditions réelles. Participez aux examens programmés et comparez vos résultats avec les autres étudiants.
          </p>
        </div>
        <div className="absolute right-0 top-0 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      </div>

      <div className="grid gap-4">
        {exams.filter(exam => {
          const hasAttempt = attempts.some(a => a.examId === exam.id);
          if (filter === 'finished') {
            const now = new Date();
            const startTime = new Date(exam.startTime);
            const endTime = new Date(startTime.getTime() + exam.durationMinutes * 60000);
            return now > endTime || hasAttempt;
          }
          return true;
        }).length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center text-gray-500 border border-gray-100 shadow-sm">
            {filter === 'finished' ? "Aucun examen passé disponible pour le moment." : "Aucun examen programmé pour le moment."}
          </div>
        ) : (
          exams.filter(exam => {
            const hasAttempt = attempts.some(a => a.examId === exam.id);
            if (filter === 'finished') {
              const now = new Date();
              const startTime = new Date(exam.startTime);
              const endTime = new Date(startTime.getTime() + exam.durationMinutes * 60000);
              return now > endTime || hasAttempt;
            }
            return true;
          }).map((exam) => {
            const examAttempts = attempts
              .filter(a => a.examId === exam.id)
              .sort((a, b) => {
                const dateA = a.submittedAt?.toDate?.() || new Date(a.submittedAt || 0);
                const dateB = b.submittedAt?.toDate?.() || new Date(b.submittedAt || 0);
                return dateB.getTime() - dateA.getTime();
              });
            const attempt = examAttempts[0]; // Most recent attempt for general logic
            const now = new Date();
            const startTime = new Date(exam.startTime);
            const endTime = new Date(startTime.getTime() + exam.durationMinutes * 60000);
            
            const isUpcoming = now < startTime;
            const isOngoing = now >= startTime && now <= endTime;
            const isFinished = now > endTime;

            return (
              <motion.div
                key={exam.id}
                whileHover={{ y: -2 }}
                className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{exam.title}</h3>
                    <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-600">
                      <span className="flex items-center gap-1.5 bg-gray-50 px-3 py-1 rounded-lg">
                        <Calendar className="w-4 h-4 text-blue-600" />
                        {startTime.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1.5 bg-gray-50 px-3 py-1 rounded-lg">
                        <Clock className="w-4 h-4 text-blue-600" />
                        {exam.durationMinutes} min
                      </span>
                      <span className="flex items-center gap-1.5 bg-gray-50 px-3 py-1 rounded-lg">
                        <FileText className="w-4 h-4 text-blue-600" />
                        {exam.questionIds?.length || 0} questions
                      </span>
                    </div>
                  </div>

                    <div className="flex flex-col items-end gap-2">
                      {examAttempts.map((att, idx) => (
                        <button
                          key={att.id}
                          onClick={() => onSelectExam(exam, att)}
                          className="px-4 py-2 bg-green-50 text-green-700 font-medium rounded-xl hover:bg-green-100 transition-colors flex items-center justify-center gap-2 text-sm w-full md:w-auto"
                        >
                          <Trophy className="w-4 h-4" />
                          Résultats {examAttempts.length > 1 ? `(Tentative ${examAttempts.length - idx})` : ''}
                        </button>
                      ))}

                      {isUpcoming ? (
                        <div className="px-6 py-2.5 bg-gray-50 text-gray-500 font-medium rounded-xl flex items-center justify-center gap-2 border border-gray-100">
                          <Clock className="w-5 h-5" />
                          Bientôt
                        </div>
                      ) : isOngoing && !attempt ? (
                        <button
                          onClick={() => onSelectExam(exam, null)}
                          className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-blue-200"
                        >
                          Commencer
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      ) : allowRecompose ? (
                        <button
                          onClick={() => onSelectExam(exam, null)}
                          className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-indigo-200"
                        >
                          Recomposer
                          <RotateCcw className="w-5 h-5" />
                        </button>
                      ) : !attempt ? (
                        <div className="px-6 py-2.5 bg-gray-50 text-gray-400 font-medium rounded-xl flex items-center justify-center gap-2 border border-gray-100">
                          Terminé
                        </div>
                      ) : null}
                    </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
