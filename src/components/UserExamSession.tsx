import React, { useState, useEffect, useRef } from 'react';
import { db, auth, getDoc, getDocs, addDoc, populateGroupContextsForQuestions } from '../lib/firebase';
import { collection, query, where, serverTimestamp, doc, orderBy, setDoc } from 'firebase/firestore';
import { Clock, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Trophy, Loader2, List, XCircle, PlayCircle, BookOpen, Sparkles, Info, Target, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn, safeLocalStorage, normalizeVFAnswer } from '../lib/utils';

export default function UserExamSession({ exam, attempt, onBack, onEnlargeImage, onShowCourseModal, onShowVideoModal }: { 
  exam: any, 
  attempt: any | null, 
  onBack: () => void,
  onEnlargeImage?: (url: string) => void,
  onShowCourseModal?: (images: string[]) => void,
  onShowVideoModal?: (url: string) => void
}) {
  const savedUser = safeLocalStorage.getItem('ais_user');
  const user = savedUser ? JSON.parse(savedUser) : null;
  const userId = user?.username;

  const [questions, _setQuestions] = useState<any[]>([]);
  const setQuestions = (newQs: any[] | ((prev: any[]) => any[])) => {
    if (typeof newQs === 'function') {
      _setQuestions(newQs);
    } else {
      populateGroupContextsForQuestions(newQs).then(resolved => {
        _setQuestions(resolved);
      });
    }
  };
  const [answers, setAnswers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string[]>>(() => {
    if (attempt) return attempt.answers || {};
    try {
      if (exam?.id) {
        const saved = safeLocalStorage.getItem(`draft_answers_${userId}_${exam.id}`);
        if (saved) return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Storage read failed", e);
    }
    return {};
  });

  const [qrocEvaluations, setQrocEvaluations] = useState<Record<string, {
    score?: number;
    strengths?: string[];
    missingPoints?: string[];
    improvedAnswer?: string;
    feedback?: string;
    reason?: string;
    hash?: string;
    error?: string;
  }>>(() => {
    if (attempt) return attempt.qrocEvaluations || {};
    try {
      if (exam?.id) {
        const saved = safeLocalStorage.getItem(`draft_qroc_evals_${userId}_${exam.id}`);
        if (saved) return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Storage read failed", e);
    }
    return {};
  });

  const [evaluatingQROCs, setEvaluatingQROCs] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [evalProgressCurrent, setEvalProgressCurrent] = useState<number>(0);
  const [evalProgressTotal, setEvalProgressTotal] = useState<number>(0);

  const [localAttempt, setLocalAttempt] = useState<any | null>(attempt);
  const isFinished = !!localAttempt;

  // --- BACKGROUND QROC EVALUATOR SERVICE ---
  const [evaluatingCount, setEvaluatingCount] = useState<number>(0);
  const MAX_CONCURRENT_QROC_EVALUATIONS = 3;

  const bgEvaluatorRef = useRef<{
    queue: Record<string, {
      questionId: string;
      questionText: string;
      officialAnswer: string;
      userAnswer: string;
      hash: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
    }>;
    activeWorkers: number;
  }>({
    queue: {},
    activeWorkers: 0
  });

  const runBgWorker = async () => {
    const state = bgEvaluatorRef.current;
    
    // Find next pending task
    const pendingId = Object.keys(state.queue).find(id => state.queue[id].status === 'pending');
    if (!pendingId) return;

    if (state.activeWorkers >= MAX_CONCURRENT_QROC_EVALUATIONS) return;

    const task = state.queue[pendingId];
    task.status = 'running';
    state.activeWorkers++;
    setEvaluatingCount(state.activeWorkers);

    try {
      const chunk = [{
        questionId: task.questionId,
        question: task.questionText,
        officialAnswer: task.officialAnswer,
        userAnswer: task.userAnswer
      }];

      const res = await fetch("/api/eval-qroc-exam-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluations: chunk })
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      
      const latestTask = state.queue[task.questionId];
      if (latestTask && latestTask.hash === task.hash) {
        if (data.results && Array.isArray(data.results) && data.results.length > 0) {
          const r = data.results[0];
          const newEvalResult = {
            score: r.score,
            reason: r.reason || "Évaluation complétée.",
            hash: task.hash
          };

          setQrocEvaluations(prev => {
            const updated = { ...prev, [task.questionId]: newEvalResult };
            try {
              safeLocalStorage.setItem(`draft_qroc_evals_${userId}_${exam.id}`, JSON.stringify(updated));
            } catch (e) {
              console.warn("Storage write failed", e);
            }
            return updated;
          });

          latestTask.status = 'completed';
        } else {
          throw new Error("Empty response from batch eval");
        }
      }
    } catch (err) {
      console.error(`Background QROC evaluation failed for ${task.questionId}`, err);
      const latestTask = state.queue[task.questionId];
      if (latestTask && latestTask.hash === task.hash) {
        latestTask.status = 'failed';
        setQrocEvaluations(prev => {
          const updated = {
            ...prev,
            [task.questionId]: {
              score: 0.0,
              reason: "Correction IA indisponible en arrière-plan.",
              hash: task.hash,
              error: "AI_ERROR"
            }
          };
          try {
            safeLocalStorage.setItem(`draft_qroc_evals_${userId}_${exam.id}`, JSON.stringify(updated));
          } catch (e) {
            console.warn("Storage write failed", e);
          }
          return updated;
        });
      }
    } finally {
      state.activeWorkers = Math.max(0, state.activeWorkers - 1);
      setEvaluatingCount(state.activeWorkers);
      runBgWorker();
    }
  };

  const startBgProcessing = () => {
    const state = bgEvaluatorRef.current;
    const pendingCount = Object.keys(state.queue).filter(id => state.queue[id].status === 'pending').length;
    if (pendingCount === 0) return;

    const availableSlots = MAX_CONCURRENT_QROC_EVALUATIONS - state.activeWorkers;
    for (let i = 0; i < Math.min(availableSlots, pendingCount); i++) {
      runBgWorker();
    }
  };

  const queueQROCEvaluation = (questionId: string) => {
    if (isFinished) return;

    const q = questions.find(item => item.id === questionId);
    if (!q || q.type !== 'QROC') return;

    const ans = answers.find(a => a.questionId === questionId);
    const officialAnswer = ans?.expectedAnswer || '';
    const userAnswerArr = userAnswers[questionId] || [];
    const userAnswer = userAnswerArr[0] || '';

    if (!userAnswer.trim()) {
      const state = bgEvaluatorRef.current;
      delete state.queue[questionId];
      
      setQrocEvaluations(prev => {
        const updated = { ...prev };
        delete updated[questionId];
        try {
          safeLocalStorage.setItem(`draft_qroc_evals_${userId}_${exam.id}`, JSON.stringify(updated));
        } catch (e) {
          console.warn("Storage write failed", e);
        }
        return updated;
      });
      return;
    }

    const currentHash = `${(q.text || '').trim()}|${(officialAnswer || '').trim()}|${userAnswer.trim()}`;

    const existingEval = qrocEvaluations[questionId];
    if (existingEval && existingEval.hash === currentHash && !existingEval.error) {
      return;
    }

    const state = bgEvaluatorRef.current;
    const existingTask = state.queue[questionId];
    if (existingTask && existingTask.hash === currentHash) {
      return;
    }

    setQrocEvaluations(prev => {
      const updated = { ...prev };
      delete updated[questionId];
      try {
        safeLocalStorage.setItem(`draft_qroc_evals_${userId}_${exam.id}`, JSON.stringify(updated));
      } catch (e) {
        console.warn("Storage write failed", e);
      }
      return updated;
    });

    state.queue[questionId] = {
      questionId,
      questionText: q.text || '',
      officialAnswer,
      userAnswer,
      hash: currentHash,
      status: 'pending'
    };

    startBgProcessing();
  };

  // Persists answers to localStorage
  useEffect(() => {
    if (isFinished) return;
    if (userId && exam?.id) {
      try {
        safeLocalStorage.setItem(`draft_answers_${userId}_${exam.id}`, JSON.stringify(userAnswers));
      } catch (e) {
        console.warn("Storage write failed", e);
      }
    }
  }, [userAnswers, isFinished, userId, exam?.id]);

  // Triggers background evaluation of previous question when user changes active index
  const lastActiveIndexRef = useRef<number>(currentIndex);
  useEffect(() => {
    if (isFinished || questions.length === 0) {
      lastActiveIndexRef.current = currentIndex;
      return;
    }

    const lastIdx = lastActiveIndexRef.current;
    if (lastIdx !== currentIndex && lastIdx < questions.length) {
      const lastQuestion = questions[lastIdx];
      if (lastQuestion && lastQuestion.type === 'QROC') {
        queueQROCEvaluation(lastQuestion.id);
      }
    }
    lastActiveIndexRef.current = currentIndex;
  }, [currentIndex, questions, isFinished]);

  // Proactively run evaluations for any restored answers from draft state on questions loading
  useEffect(() => {
    if (isFinished || questions.length === 0 || answers.length === 0) return;

    questions.forEach(q => {
      if (q.type === 'QROC') {
        const userAns = userAnswers[q.id] || [];
        const userStr = userAns[0] || '';
        if (userStr.trim()) {
          queueQROCEvaluation(q.id);
        }
      }
    });
  }, [questions, answers]);

  useEffect(() => {
    if (isFinished) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isFinished]);

  useEffect(() => {
    fetchQuestions();
    if (isFinished) {
      fetchLeaderboard();
    } else if (exam.startTime) {
      // Calculate time left for scheduled exams
      const now = new Date().getTime();
      const endTime = new Date(exam.startTime).getTime() + exam.durationMinutes * 60000;
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      setTimeLeft(remaining);
    } else {
      // For simulations, start timer from durationMinutes
      setTimeLeft(exam.durationMinutes * 60);
    }
  }, []);

  useEffect(() => {
    if (isFinished || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, isFinished]);

  const fetchQuestions = async () => {
    try {
      // Firebase 'in' query supports max 10 items. We might have 50 questions.
      // So we fetch them in chunks.
      const qIds = exam.questionIds || [];
      let fetchedQuestions: any[] = [];
      let fetchedAnswers: any[] = [];

      for (let i = 0; i < qIds.length; i += 10) {
        const chunk = qIds.slice(i, i + 10);
        const qSnap = await getDocs(query(collection(db, 'questions'), where('__name__', 'in', chunk)));
        fetchedQuestions = [...fetchedQuestions, ...qSnap.docs.map(d => ({ id: d.id, ...d.data() }))];
        
        const aSnap = await getDocs(query(collection(db, 'answers'), where('questionId', 'in', chunk)));
        fetchedAnswers = [...fetchedAnswers, ...aSnap.docs.map(d => ({ id: d.id, ...d.data() }))];
      }

      // Sort questions to match the order in exam.questionIds
      fetchedQuestions.sort((a, b) => qIds.indexOf(a.id) - qIds.indexOf(b.id));

      // Fetch chapters to get titles
      const chapterIds = [...new Set(fetchedQuestions.map(q => q.chapterId))];
      const chapters: any[] = [];
      for (let i = 0; i < chapterIds.length; i += 10) {
        const chunk = chapterIds.slice(i, i + 10);
        if (chunk.length > 0) {
          const cSnap = await getDocs(query(collection(db, 'chapters'), where('__name__', 'in', chunk)));
          chapters.push(...cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      }
      const chapterMap = chapters.reduce((acc, c) => {
        acc[c.id] = c.title || 'Autre';
        return acc;
      }, {} as Record<string, string>);

      const mergedQuestions = fetchedQuestions.map(q => {
        const ans = fetchedAnswers.find(a => a.questionId === q.id);
        const images: { url: string, type: 'question' | 'answer' }[] = [];
        
        if (q.images) {
          images.push(...q.images);
        } else {
          if (q.imageUrls) {
            q.imageUrls.forEach((url: string) => images.push({ url, type: 'question' }));
          } else if (q.imageUrl) {
            images.push({ url: q.imageUrl, type: 'question' });
          }
        }

        if (ans) {
          if (ans.images) {
            images.push(...ans.images.filter((img: any) => img.type === 'answer'));
          } else {
            const correctionUrls = ans.correctionImageUrls || ans.imageUrls;
            if (correctionUrls) {
              correctionUrls.forEach((url: string) => images.push({ url, type: 'answer' }));
            } else if (ans.imageUrl) {
              images.push({ url: ans.imageUrl, type: 'answer' });
            }
          }
        }

        return { ...q, images, chapterTitle: chapterMap[q.chapterId] || 'Autre' };
      });

      // Group questions by chapter title
      mergedQuestions.sort((a, b) => a.chapterTitle.localeCompare(b.chapterTitle));

      setQuestions(mergedQuestions);
      setAnswers(fetchedAnswers);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'examAttempts'), where('examId', '==', exam.id), orderBy('score', 'desc')));
      setLeaderboard(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleOptionSelect = (questionId: string, optionLetterOrValue: string) => {
    if (isFinished) return;
    setUserAnswers(prev => {
      const q = questions.find(q => q.id === questionId);
      const isQROC = q?.type === 'QROC';
      
      if (isQROC) {
        return { ...prev, [questionId]: [optionLetterOrValue] }; // Wrap in array to maintain signature or we can change signature
      }

      const isVraiFaux = q?.type === 'VRAI_FAUX';
      if (isVraiFaux) {
        return { ...prev, [questionId]: [optionLetterOrValue] };
      }

      const current = prev[questionId] || [];
      if (current.includes(optionLetterOrValue)) {
        return { ...prev, [questionId]: current.filter(l => l !== optionLetterOrValue) };
      } else {
        return { ...prev, [questionId]: [...current, optionLetterOrValue].sort() };
      }
    });
  };

  const handleSubmit = async () => {
    if (isFinished || submitting) return;
    setSubmitting(true);
    setEvaluatingQROCs(true);
    try {
      // Find all QROC questions
      const qrocQuestions = questions.filter(q => q.type === 'QROC');
      const evaluationsToSave: Record<string, any> = {};

      const itemsToEvaluate: any[] = [];

      qrocQuestions.forEach((q) => {
        const userAns = userAnswers[q.id] || [];
        const ans = answers.find(a => a.questionId === q.id);
        const userStr = userAns[0] || '';
        const expectedStr = ans?.expectedAnswer || '';

        if (!userStr.trim()) {
          evaluationsToSave[q.id] = {
            score: 0.0,
            reason: "Question non répondue.",
            hash: `${(q.text || '').trim()}|${(expectedStr || '').trim()}|`
          };
        } else {
          const currentHash = `${(q.text || '').trim()}|${(expectedStr || '').trim()}|${userStr.trim()}`;
          const existingEval = qrocEvaluations[q.id];

          if (existingEval && existingEval.hash === currentHash && !existingEval.error) {
            evaluationsToSave[q.id] = {
              score: existingEval.score,
              reason: existingEval.reason || "Évaluation complétée.",
              hash: currentHash
            };
          } else {
            itemsToEvaluate.push({
              questionId: q.id,
              question: q.text || "",
              officialAnswer: expectedStr,
              userAnswer: userStr,
              hash: currentHash
            });
          }
        }
      });

      if (itemsToEvaluate.length > 0) {
        const CHUNK_SIZE = 5;
        const chunks: any[][] = [];
        for (let i = 0; i < itemsToEvaluate.length; i += CHUNK_SIZE) {
          chunks.push(itemsToEvaluate.slice(i, i + CHUNK_SIZE));
        }

        setEvalProgressTotal(chunks.length);
        setEvalProgressCurrent(0);

        let completedChunksCount = 0;

        await Promise.all(chunks.map(async (chunk, cIdx) => {
          try {
            const res = await fetch("/api/eval-qroc-exam-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ evaluations: chunk })
            });
            const data = await res.json();
            if (data.results && Array.isArray(data.results)) {
              data.results.forEach((r: any) => {
                const item = chunk.find(it => it.questionId === r.questionId);
                evaluationsToSave[r.questionId] = {
                  score: r.score,
                  reason: r.reason || "Évaluation complétée.",
                  hash: item?.hash
                };
              });
            } else {
              console.warn("Invalid response structure for chunk", cIdx, data);
              chunk.forEach(item => {
                evaluationsToSave[item.questionId] = {
                  score: 0.0,
                  reason: "Correction IA indisponible.",
                  hash: item.hash
                };
              });
            }
          } catch (err) {
            console.error(`Chunk evaluation failed for chunk ${cIdx}`, err);
            chunk.forEach(item => {
              evaluationsToSave[item.questionId] = {
                score: 0.0,
                reason: "Correction IA indisponible.",
                hash: item.hash
              };
            });
          } finally {
            completedChunksCount++;
            setEvalProgressCurrent(completedChunksCount);
          }
        }));
      }

      setQrocEvaluations(evaluationsToSave);
      setEvaluatingQROCs(false);

      // Clear draft localStorage fields on successful evaluation completion
      try {
        safeLocalStorage.removeItem(`draft_answers_${userId}_${exam.id}`);
        safeLocalStorage.removeItem(`draft_qroc_evals_${userId}_${exam.id}`);
      } catch (e) {
        console.warn("Could not clear drafts from safeLocalStorage", e);
      }

      let score = 0;
      let correctCount = 0;
      let incorrectCount = 0;
      let unansweredCount = 0;

      questions.forEach(q => {
        const ans = answers.find(a => a.questionId === q.id);
        const userAns = userAnswers[q.id] || [];
        
        if (userAns.length === 0 || (userAns.length === 1 && !userAns[0].trim() && q.type === 'QROC')) {
          unansweredCount++;
        } else if (ans) {
          if (q.type === 'QROC') {
            const aiScore = evaluationsToSave[q.id]?.score || 0.0;
            score += aiScore;
            if (aiScore >= 0.5) {
              correctCount++;
            } else {
              incorrectCount++;
            }
          } else {
            const correctLetters = ans.correctLetters || [ans.correctLetter];
            let isCorrect = false;
            if (q.type === 'VRAI_FAUX') {
              const normUser = userAns.map(normalizeVFAnswer).filter(Boolean);
              const normCorrect = correctLetters.map(normalizeVFAnswer).filter(Boolean);
              isCorrect = normUser.length === normCorrect.length && normUser.every(l => normCorrect.includes(l));
            } else {
              isCorrect = userAns.length === correctLetters.length && userAns.every(l => correctLetters.includes(l));
            }
            if (isCorrect) {
              score++;
              correctCount++;
            } else {
              incorrectCount++;
            }
          }
        }
      });

      // Decimal scores are rounded cleanly for overall score
      const finalDisplayScore = typeof score === 'number' ? Number(score.toFixed(2)) : score;

      const attemptData = {
        examId: exam.id,
        userId: userId,
        userName: user?.displayName || user?.username || 'Utilisateur Anonyme',
        score: finalDisplayScore,
        correctCount,
        incorrectCount,
        unansweredCount,
        totalQuestions: questions.length,
        answers: userAnswers,
        qrocEvaluations: evaluationsToSave,
        submittedAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'examAttempts'), {
        ...attemptData,
        submittedAt: serverTimestamp()
      });

      // Update statistics
      const evaluatedActiveQROCs = Object.values(evaluationsToSave).filter((e: any) => e.score !== undefined);
      if (evaluatedActiveQROCs.length > 0 && userId) {
        const statsRef = doc(db, 'users', userId, 'stats', 'qrocStats');
        getDoc(statsRef).then(snap => {
          let count = evaluatedActiveQROCs.length;
          
          // Map scores to a standard 0-100 system for historical compatibility
          const scaledScores = evaluatedActiveQROCs.map((e: any) => {
            const s = e.score || 0;
            return s <= 1.0 ? Math.round(s * 100) : Math.round(s);
          });

          let sum = scaledScores.reduce((acc, current: number) => acc + current, 0);
          let max = Math.max(...scaledScores);
          let min = Math.min(...scaledScores);
          let history = scaledScores.map((score: number) => ({ date: new Date().toISOString(), score }));
          
          if (snap && snap.exists()) {
            const existing = snap.data();
            count += (existing.count || 0);
            sum += (existing.scoreSum || 0);
            max = Math.max(existing.maxScore || 0, max);
            min = Math.min(existing.minScore !== undefined ? existing.minScore : 100, min);
            history = [...(existing.history || []), ...history];
          }
          
          setDoc(statsRef, {
            count,
            scoreSum: sum,
            avgScore: Math.round(sum / count),
            maxScore: max,
            minScore: min,
            history
          }, { merge: true }).catch(err => console.warn("Error updating QROC stats:", err));
        }).catch(err => console.warn("Error getting QROC stats:", err));
      }

      setLocalAttempt(attemptData);
      setEvaluatingQROCs(false);
      setSubmitting(false);
      if (exam.isSimulation) {
        // Stay on page to show results for simulations
      } else {
        onBack(); // Go back for real exams
      }
    } catch (err) {
      console.error(err);
      try {
        alert("Erreur lors de la soumission.");
      } catch (e) {
        console.warn("Could not show alert in iframe:", e);
      }
      setEvaluatingQROCs(false);
      setSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  if (submitting || evaluatingQROCs) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[400px] gap-6 p-8 max-w-md mx-auto text-center font-sans">
        <div className="p-4 bg-indigo-50 rounded-full text-indigo-600 relative">
          <Loader2 className="w-12 h-12 animate-spin" />
          <Sparkles className="w-5 h-5 text-indigo-400 absolute top-2 right-2 animate-bounce" />
        </div>
        <div className="space-y-2">
          <h3 className="font-extrabold text-gray-800 text-lg">Correction IA de vos QROC</h3>
          <p className="text-xs text-indigo-600 font-bold uppercase tracking-wider animate-pulse">Analyse sémantique et médicale en cours...</p>
          {evalProgressTotal > 0 && (
            <div className="mt-4 bg-indigo-50 px-4 py-2.5 rounded-xl border border-indigo-100 flex flex-col gap-1.5 items-center">
              <span className="text-xs font-extrabold text-indigo-800 uppercase tracking-widest leading-none">Progression de l'évaluation</span>
              <span className="text-sm font-black text-indigo-950">Lot {evalProgressCurrent} / {evalProgressTotal}</span>
              <div className="w-24 h-1.5 bg-indigo-100 rounded-full overflow-hidden mt-1">
                <div 
                  className="h-full bg-indigo-600 rounded-full transition-all duration-300" 
                  style={{ width: `${(evalProgressCurrent / evalProgressTotal) * 100}%` }}
                />
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 leading-relaxed font-medium">
            L'examinateur virtuel compare vos réponses rédigées au barème de correction officielle pour vous fournir un score précis et des pistes de progression.
          </p>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers.find(a => a.questionId === currentQuestion?.id);
  const correctLetters = currentAnswer?.correctLetters || [currentAnswer?.correctLetter];

  return (
    <div className="max-w-5xl mx-auto space-y-6 px-4 md:px-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col md:flex-row">
        {/* Main Content */}
        <div className="flex-1 p-4 md:p-8 border-b md:border-b-0 md:border-r border-gray-100 pb-32">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              {isFinished && (
                <button 
                  onClick={onBack}
                  className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1"
                  title="Retour"
                >
                  <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                </button>
              )}
              <h2 className="text-xl font-bold text-gray-900">Question {currentIndex + 1} / {questions.length}</h2>
              <span className="text-sm font-medium text-blue-600 bg-blue-50 px-3 py-1 rounded-full capitalize">
                {currentQuestion?.chapterTitle || 'Autre'}
              </span>
              {!isFinished && evaluatingCount > 0 && (
                <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                  <Sparkles className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                  Correction IA en arrière plan...
                </span>
              )}
            </div>
            {!isFinished && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono font-bold ${timeLeft < 300 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                <Clock className="w-5 h-5" />
                {formatTime(timeLeft)}
              </div>
            )}
            {isFinished && localAttempt && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 px-3 py-1 rounded-lg font-bold bg-green-50 text-green-700 text-sm">
                  <Trophy className="w-4 h-4" />
                  {localAttempt.score} / {localAttempt.totalQuestions} ({Math.round((localAttempt.score / localAttempt.totalQuestions) * 100)}%)
                </div>
              </div>
            )}
          </div>

          {/* Floating Navigation Bar */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 bg-white/90 backdrop-blur-xl px-4 py-3 rounded-2xl border border-gray-200 shadow-[0_20px_50px_rgba(0,0,0,0.1)] min-w-[280px] sm:min-w-[320px] justify-between animate-in slide-in-from-bottom-4 duration-500">
            <button
              onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className="flex-1 px-4 py-2.5 text-indigo-600 hover:bg-indigo-50 rounded-xl disabled:opacity-30 transition-all flex items-center justify-center gap-2 font-bold text-sm sm:text-base"
            >
              <ChevronLeft className="w-5 h-5" /> <span className="hidden sm:inline">Précédent</span><span className="sm:hidden">Préc.</span>
            </button>
            
            <div className="w-px h-8 bg-gray-100 mx-1" />

            <button
              onClick={() => setCurrentIndex(prev => Math.min(questions.length - 1, prev + 1))}
              disabled={currentIndex === questions.length - 1}
              className="flex-1 px-4 py-2.5 text-indigo-600 hover:bg-indigo-50 rounded-xl disabled:opacity-30 transition-all flex items-center justify-center gap-2 font-bold text-sm sm:text-base"
            >
              <span className="hidden sm:inline">Suivant</span><span className="sm:hidden">Suiv.</span> <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {isFinished && localAttempt && (
            <div className="mb-8 p-4 bg-gray-50 rounded-xl border border-gray-100 flex gap-4 justify-center">
              <span className="text-xs font-bold px-2 py-1 bg-green-100 text-green-700 rounded-lg">
                {localAttempt.correctCount || 0} Correctes
              </span>
              <span className="text-xs font-bold px-2 py-1 bg-red-100 text-red-700 rounded-lg">
                {localAttempt.incorrectCount || 0} Incorrectes
              </span>
              <span className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-700 rounded-lg">
                {localAttempt.unansweredCount || 0} Omises
              </span>
            </div>
          )}

          {currentQuestion && (
            <div className="space-y-6">
              {(currentQuestion.sharedStem || currentQuestion.groupTitle) && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl mb-4 shadow-sm relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400" />
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {currentQuestion.groupTitle || 'Énoncé Commun'}
                  </p>
                  {currentQuestion.sharedStem && (
                    <p className="text-gray-800 font-medium italic leading-relaxed">
                      {currentQuestion.sharedStem}
                    </p>
                  )}
                </div>
              )}
              <p className="text-lg text-gray-800 leading-relaxed">{currentQuestion.text}</p>
              
              {/* Question Images */}
              {currentQuestion.images && currentQuestion.images.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {currentQuestion.images.filter((img: any) => img.type === 'question').map((img: any, idx: number) => (
                    <img 
                      key={idx} 
                      src={img.url} 
                      alt={`Question ${idx + 1}`} 
                      className="rounded-xl max-h-64 object-contain bg-gray-50 border border-gray-100 cursor-zoom-in hover:opacity-90 transition-opacity"
                      referrerPolicy="no-referrer"
                      onClick={() => onEnlargeImage?.(img.url)}
                    />
                  ))}
                </div>
              )}

              {/* Render Options Based on Type */}
              <div className="space-y-3">
                {currentQuestion.type === 'QROC' ? (
                  <div className="mt-4">
                    <textarea
                      disabled={isFinished}
                      value={(userAnswers[currentQuestion.id] || [])[0] || ''}
                      onChange={(e) => handleOptionSelect(currentQuestion.id, e.target.value)}
                      onBlur={() => queueQROCEvaluation(currentQuestion.id)}
                      placeholder="Tapez votre réponse ici..."
                      className={cn(
                        "w-full p-4 rounded-xl border-2 text-gray-700 bg-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-all resize-none min-h-[120px]",
                        isFinished && "opacity-80 disabled:opacity-80"
                      )}
                    />
                    {isFinished && currentAnswer && (
                      <div className="mt-6 space-y-6">
                        {/* Original Correctness Notice */}
                        <div className={cn(
                          "p-4 rounded-xl border font-semibold flex items-start gap-3",
                          ((userAnswers[currentQuestion.id] || [])[0] || '').trim().toLowerCase() === (currentAnswer.expectedAnswer || '').trim().toLowerCase() 
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                            : "bg-amber-50 border-amber-200 text-amber-800"
                        )}>
                          {((userAnswers[currentQuestion.id] || [])[0] || '').trim().toLowerCase() === (currentAnswer.expectedAnswer || '').trim().toLowerCase() 
                            ? <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" /> 
                            : <Info className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                          }
                          <div className="text-xs md:text-sm text-left">
                            <div>Votre réponse : <span className="font-bold">{(userAnswers[currentQuestion.id] || [])[0] || "Aucune"}</span></div>
                            <div className="mt-1">Réponse attendue : <span className="font-bold text-indigo-700">{currentAnswer.expectedAnswer}</span></div>
                          </div>
                        </div>

                        {/* --- QROC IA EVALUATOR REPORT CARD --- */}
                        {qrocEvaluations && qrocEvaluations[currentQuestion.id] && (
                          <div className="bg-gradient-to-br from-slate-50/50 to-indigo-50/20 border border-slate-200 p-6 rounded-2xl space-y-4 shadow-sm">
                            <div className="flex items-center justify-between border-b border-gray-150 pb-3">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                                <h3 className="font-bold text-sm uppercase tracking-wide text-slate-800 leading-none">Note & Justification IA</h3>
                              </div>
                              
                              {qrocEvaluations[currentQuestion.id].score !== undefined && (
                                <div className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1 rounded-xl font-bold text-xs md:text-sm shadow-sm">
                                  <Target className="w-3.5 h-3.5 text-indigo-100" />
                                  <span>Score : {qrocEvaluations[currentQuestion.id].score} / 1.0</span>
                                </div>
                              )}
                            </div>

                            <div className="space-y-3 font-sans">
                              {/* Short Score Label */}
                              <div className="flex items-center justify-between bg-white text-slate-800 p-3.5 rounded-xl border border-gray-200/80">
                                <div className="space-y-0.5 text-left">
                                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Résultat de Correction</span>
                                  <p className="text-xs text-slate-600 leading-relaxed font-semibold">
                                    Évalué par QROCEvaluatorExam.
                                  </p>
                                </div>
                                <div className="relative flex items-center justify-center shrink-0 w-12 h-12 rounded-full border-2 border-indigo-100 bg-indigo-50 shadow-sm">
                                  <span className="font-extrabold text-sm text-indigo-950">{(qrocEvaluations[currentQuestion.id].score * 100).toFixed(0)}%</span>
                                </div>
                              </div>

                              {/* Justification unique */}
                              {qrocEvaluations[currentQuestion.id].reason && (
                                <div className="space-y-1 text-left">
                                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Justification</h4>
                                  <p className="p-3 bg-indigo-50/30 border border-indigo-100/50 rounded-xl text-xs text-slate-700 font-medium leading-relaxed font-sans">
                                    {qrocEvaluations[currentQuestion.id].reason}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  currentQuestion.options.map((opt: any, idx: number) => {
                    const isSelected = (userAnswers[currentQuestion.id] || []).includes(opt.letter);
                    const isCorrect = currentQuestion.type === 'VRAI_FAUX'
                      ? correctLetters.some(cl => normalizeVFAnswer(cl) === normalizeVFAnswer(opt.letter))
                      : correctLetters.includes(opt.letter);
                    
                    let btnClass = "w-full text-left p-4 rounded-xl border-2 transition-all ";
                    if (isFinished) {
                      if (isCorrect) btnClass += "border-green-500 bg-green-50";
                      else if (isSelected && !isCorrect) btnClass += "border-red-500 bg-red-50";
                      else btnClass += "border-gray-100 bg-white opacity-50";
                    } else {
                      if (isSelected) btnClass += "border-blue-500 bg-blue-50";
                      else btnClass += "border-gray-100 bg-white hover:border-gray-200";
                    }

                    return (
                      <button
                        key={`${opt.letter}-${idx}`}
                        onClick={() => handleOptionSelect(currentQuestion.id, opt.letter)}
                        disabled={isFinished}
                        className={btnClass}
                      >
                        <div className="flex items-start gap-4">
                          <div className={cn(
                            "w-5 h-5 mt-0.5 flex flex-shrink-0 items-center justify-center transition-colors border-2",
                            currentQuestion.type === 'VRAI_FAUX' ? "rounded-full" : "rounded",
                            isSelected && !isFinished ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300",
                            isFinished && isCorrect ? "bg-green-600 border-green-600" : "",
                            isFinished && isSelected && !isCorrect ? "bg-red-600 border-red-600" : ""
                          )}>
                            {(isSelected || (isFinished && isCorrect)) && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                          </div>
                          {currentQuestion.type !== 'VRAI_FAUX' && <span className="font-bold text-gray-500 w-6 mt-0.5 shrink-0">{opt.letter}.</span>}
                          <span className="text-gray-700 font-medium flex-1">{opt.text}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {isFinished && currentAnswer && (
                <div className="mt-8 space-y-6">
                  {/* Answer Images */}
                  {currentQuestion.images && currentQuestion.images.some((img: any) => img.type === 'answer') && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {currentQuestion.images.filter((img: any) => img.type === 'answer').map((img: any, idx: number) => (
                        <img 
                          key={idx} 
                          src={img.url} 
                          alt={`Correction ${idx + 1}`} 
                          className="rounded-xl max-h-64 object-contain bg-gray-50 border border-gray-100 cursor-zoom-in hover:opacity-90 transition-opacity"
                          referrerPolicy="no-referrer"
                          onClick={() => onEnlargeImage?.(img.url)}
                        />
                      ))}
                    </div>
                  )}

                  <div className="p-6 bg-blue-50 rounded-xl border border-blue-100">
                    <h4 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5" /> Explication
                    </h4>
                    <p className="text-blue-800 whitespace-pre-wrap">{currentAnswer.explanation}</p>
                  </div>

                  {currentQuestion.courseImages && currentQuestion.courseImages.length > 0 && onShowCourseModal && (
                    <div className="flex flex-col sm:flex-row gap-3 mt-6">
                      <button 
                        onClick={() => onShowCourseModal(currentQuestion.courseImages)}
                        className="flex-1 flex items-center justify-center gap-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold py-4 px-4 rounded-xl transition-colors shadow-sm"
                      >
                        <BookOpen className="w-5 h-5" /> Voir la fiche
                      </button>
                      {currentQuestion.courseVideos && currentQuestion.courseVideos.length > 0 && onShowVideoModal && (
                        <button 
                          onClick={() => onShowVideoModal(currentQuestion.courseVideos[0])}
                          className="flex-1 flex items-center justify-center gap-2 bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold py-4 px-4 rounded-xl transition-colors shadow-sm"
                        >
                          <PlayCircle className="w-5 h-5" /> Voir la vidéo
                        </button>
                      )}
                    </div>
                  )}

                  {!currentQuestion.courseImages && currentQuestion.courseVideos && currentQuestion.courseVideos.length > 0 && onShowVideoModal && (
                    <button 
                      onClick={() => onShowVideoModal(currentQuestion.courseVideos[0])}
                      className="mt-6 w-full flex items-center justify-center gap-2 bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold py-4 px-4 rounded-xl transition-colors shadow-sm"
                    >
                      <PlayCircle className="w-5 h-5" /> Voir la vidéo
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar Navigation */}
        <div className="w-full md:w-64 bg-gray-50 p-6 flex flex-col">
          {!isFinished && (
            <button
              onClick={() => setShowConfirmSubmit(true)}
              disabled={submitting}
              className="w-full mb-6 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-100 flex items-center justify-center gap-2 group"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5 group-hover:scale-110 transition-transform" />}
              Rendre ma copie
            </button>
          )}

          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <List className="w-5 h-5 text-gray-500" /> Navigation
          </h3>
          <div className="space-y-6 overflow-y-auto custom-scrollbar pr-2 pb-4">
            {(Object.entries(
              questions.reduce((acc, q, idx) => {
                const section = q.chapterTitle || 'Autre';
                if (!acc[section]) acc[section] = [];
                acc[section].push({ q, idx });
                return acc;
              }, {} as Record<string, { q: any, idx: number }[]>)
            ) as [string, { q: any, idx: number }[]][]).map(([section, sectionQuestions]) => (
              <div key={section} className="space-y-3">
                <h4 className="text-sm font-bold text-gray-700 capitalize border-b border-gray-200 pb-1">{section}</h4>
                <div className="grid grid-cols-5 md:grid-cols-4 gap-2">
                  {sectionQuestions.map(({ q, idx }) => {
                    const isAnswered = (userAnswers[q.id] || []).length > 0;
                    const isCurrent = idx === currentIndex;
                    
                    let btnClass = "w-10 h-10 rounded-lg font-medium text-sm flex items-center justify-center transition-colors ";
                    
                    if (isFinished) {
                      const ans = answers.find(a => a.questionId === q.id);
                      let isCorrect = false;
                      const userAns = userAnswers[q.id] || [];
                      
                      if (q.type === 'QROC') {
                        isCorrect = (userAns[0] || '').trim().toLowerCase() === (ans?.expectedAnswer || '').trim().toLowerCase();
                      } else if (q.type === 'VRAI_FAUX') {
                        const correctLetters = ans?.correctLetters || [ans?.correctLetter || ''];
                        const normUser = userAns.map(normalizeVFAnswer).filter(Boolean);
                        const normCorrect = correctLetters.map(normalizeVFAnswer).filter(Boolean);
                        isCorrect = normUser.length === normCorrect.length && normUser.every(l => normCorrect.includes(l));
                      } else {
                        const correctLetters = ans?.correctLetters || [ans?.correctLetter || ''];
                        isCorrect = userAns.length === correctLetters.length && userAns.every(l => correctLetters.includes(l));
                      }
                      
                      if (isCurrent) btnClass += "ring-2 ring-blue-500 ring-offset-2 ";
                      if (isCorrect) btnClass += "bg-green-100 text-green-700 border border-green-200";
                      else if (isAnswered) btnClass += "bg-red-100 text-red-700 border border-red-200";
                      else btnClass += "bg-gray-200 text-gray-500";
                    } else {
                      if (isCurrent) btnClass += "bg-blue-600 text-white shadow-md";
                      else if (isAnswered) btnClass += "bg-blue-100 text-blue-700 border border-blue-200";
                      else btnClass += "bg-white text-gray-600 border border-gray-200 hover:border-blue-300";
                    }

                    return (
                      <button
                        key={q.id}
                        onClick={() => setCurrentIndex(idx)}
                        className={btnClass}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      {isFinished && leaderboard.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 md:p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-500" />
            Classement Global
          </h2>
          <div className="space-y-3">
            {leaderboard.slice(0, 10).map((entry, idx) => (
              <div key={entry.id} className={`flex items-center justify-between p-4 rounded-xl border ${entry.userId === userId ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${idx === 0 ? 'bg-yellow-100 text-yellow-700' : idx === 1 ? 'bg-gray-200 text-gray-700' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-white text-gray-500'}`}>
                    {idx + 1}
                  </div>
                  <span className="font-medium text-gray-900">{entry.userName}</span>
                  {entry.userId === userId && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">Vous</span>}
                </div>
                <div className="font-bold text-gray-900">
                  {entry.score} <span className="text-gray-500 text-sm font-normal">/ {entry.totalQuestions}</span>
                </div>
              </div>
            ))}
            
            {/* Show user position if not in top 10 */}
            {leaderboard.findIndex(e => e.userId === userId) >= 10 && (
              <>
                <div className="text-center text-gray-400 py-2">...</div>
                <div className="flex items-center justify-between p-4 rounded-xl border bg-blue-50 border-blue-200">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold bg-white text-gray-500">
                      {leaderboard.findIndex(e => e.userId === userId) + 1}
                    </div>
                    <span className="font-medium text-gray-900">{user?.displayName || 'Vous'}</span>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">Vous</span>
                  </div>
                  <div className="font-bold text-gray-900">
                    {attempt?.score} <span className="text-gray-500 text-sm font-normal">/ {attempt?.totalQuestions}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmSubmit && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-100"
          >
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6 mx-auto">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 text-center mb-2">Rendre la copie ?</h3>
            <p className="text-gray-500 text-center mb-8">
              Êtes-vous sûr de vouloir rendre votre copie ? Cette action est irréversible et vous ne pourrez plus modifier vos réponses.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmSubmit(false)}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                disabled={submitting}
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  setShowConfirmSubmit(false);
                  handleSubmit();
                }}
                className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                disabled={submitting}
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirmer"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
