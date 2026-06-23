import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Book, ChevronRight, CheckCircle2, Check, XCircle, ArrowLeft, ArrowRight, Layout, Loader2, Clock, Settings, Play, FileText, BarChart3, AlertTriangle, ZoomIn, ZoomOut, RotateCcw, X, LayoutGrid, TrendingUp, Calendar, Trophy, Flame, Star, Target, Award, Layers, Maximize2, ListChecks, Bell, Lock, GraduationCap, Crown, List, Menu, LogOut, History, PlayCircle, MonitorPlay, BookOpen, Sparkles, HelpCircle, GitBranch, ExternalLink, Download, CheckCircle, AlertCircle, FileUp, Info, Users, Trash2, ToggleLeft, CheckSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, safeLocalStorage, normalizeVFAnswer } from '../lib/utils';
import { db, auth, handleFirestoreError, OperationType, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, onSnapshot, populateGroupContextsForQuestions } from '../lib/firebase';
import { collection, query, where, orderBy, doc, serverTimestamp, writeBatch, increment } from 'firebase/firestore';

type ViewState = 'dashboard' | 'simulation' | 'books' | 'chapters' | 'blocks' | 'training' | 'progression' | 'planning' | 'errors' | 'redo_missed_questions' | 'retake_past_exams' | 'exams' | 'exam_session' | 'simulation_config' | 'simulation_session' | 'revision' | 'revision_session' | 'settings';

import UserExamList from './UserExamList.tsx';
import { GamificationHeader } from './GamificationHeader.tsx';
import UserExamSession from './UserExamSession.tsx';
import { InteractiveGuide } from './InteractiveGuide.tsx';
import MindMapCard from './MindMapCard.tsx';
import { parseMindMapText } from '../lib/treeParser';
import { useNotifications } from '../hooks/useNotifications';

import { FILIERE_OPTIONS, getLevelsForFiliere } from '../lib/constants';

interface SimulationConfig {
  durationMinutes: number;
  questionCount: number;
  selectedBooks: string[];
  selectedChapters: string[];
  selectedBlocks: string[];
  drawMode: 'random' | 'sequential';
}

interface SimulationSession {
  id?: string;
  createdAt: any;
  startedAt: any;
  endedAt: any | null;
  durationMinutes: number;
  timeExpired: boolean;
  books: string[];
  chapters: string[];
  blocks: string[];
  questionIds: string[];
  responses: Record<number, { questionId: string; selectedAnswer: string; correctAnswer: string; isCorrect: boolean }>;
  score: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  status: 'in_progress' | 'completed' | 'expired';
}

const buildQuestionWithImages = (q: any, ans: any) => {
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
      // Handle both legacy 'imageUrls' and new 'correctionImageUrls'
      const correctionUrls = ans.correctionImageUrls || ans.imageUrls;
      if (correctionUrls) {
        correctionUrls.forEach((url: string) => images.push({ url, type: 'answer' }));
      } else if (ans.imageUrl) {
        images.push({ url: ans.imageUrl, type: 'answer' });
      }
    }
  }

  return {
    ...q,
    answer: ans,
    images
  };
};

interface UserInterfaceProps {
  user: any;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isAdmin: boolean;
  onExamStateChange?: (isActive: boolean) => void;
  onLogout?: () => void;
  onUpdateUser?: (data: any) => void;
  onSwitchToPartnerSpace?: () => void;
}

const DEMO_LIMITS = {
  MAX_BOOKS: 1,
  MAX_CHAPTERS: 1,
  MAX_BLOCKS: 1,
  MAX_QUESTIONS: 10,
  ALLOWED_BOOK_NAMES: ['Lange', 'Pré-test', 'Pre-test', 'Diagest', 'EM5', 'MINSANTE']
};

export default function UserInterface({ user, isSidebarOpen, setIsSidebarOpen, isAdmin, onExamStateChange, onLogout, onUpdateUser, onSwitchToPartnerSpace }: UserInterfaceProps) {
  const { permission, requestPermission } = useNotifications();

  useEffect(() => {
    if (permission === 'default' && user) {
      requestPermission();
    }
  }, [permission, user]);
  const location = useLocation();
  const navigate = useNavigate();
  const userId = user?.username; // Using username as the ID for custom session logic
  const isDemo = user?.isDemo;
  const userFiliere = user?.filiere || 'ECN';
  const userNiveau = user?.niveau || 'ALL';

  const [demoQuestionsCount, setDemoQuestionsCount] = useState(() => {
    const saved = safeLocalStorage.getItem('ais_demo_count');
    return saved ? parseInt(saved, 10) : 0;
  });

  useEffect(() => {
    if (isDemo) {
      safeLocalStorage.setItem('ais_demo_count', demoQuestionsCount.toString());
    }
  }, [demoQuestionsCount, isDemo]);

  const isBookAccessible = (book: any) => {
    if (!isDemo) return true;
    const allowedNames = DEMO_LIMITS.ALLOWED_BOOK_NAMES;
    const isAllowedName = allowedNames.some(name => book.name.toLowerCase().includes(name.toLowerCase()));
    if (isAllowedName) return true;
    // If no allowed names match, allow the first book in the list
    return books.findIndex(b => b.id === book.id) === 0;
  };

  const isChapterAccessible = (chapter: any, index: number) => {
    if (!isDemo) return true;
    return index < DEMO_LIMITS.MAX_CHAPTERS;
  };

  const isBlockAccessible = (block: any, index: number) => {
    if (!isDemo) return true;
    return index < DEMO_LIMITS.MAX_BLOCKS;
  };
  
  const [view, _setView] = useState<ViewState>('dashboard');
  const [examSourceView, setExamSourceView] = useState<ViewState>('exams');

  const [selectedExam, setSelectedExam] = useState<any | null>(null);
  const [selectedExamAttempt, setSelectedExamAttempt] = useState<any | null>(null);

  const isExamActive = view === 'exam_session' && !selectedExamAttempt;

  useEffect(() => {
    if (onExamStateChange) {
      onExamStateChange(isExamActive);
    }
  }, [view, selectedExamAttempt, onExamStateChange, isExamActive]);

  useEffect(() => {
    if (location.pathname === '/') _setView('dashboard');
    else if (location.pathname === '/simulation') _setView('simulation');
    else if (location.pathname === '/training') _setView('books');
    else if (location.pathname === '/training/chapters') _setView('chapters');
    else if (location.pathname === '/training/blocks') _setView('blocks');
    else if (location.pathname === '/training/session') _setView('training');
    else if (location.pathname === '/simulation/config') _setView('simulation_config');
    else if (location.pathname === '/simulation/session') _setView('simulation_session');
    else if (location.pathname === '/planning') _setView('planning');
    else if (location.pathname === '/progression') _setView('progression');
    else if (location.pathname === '/errors') _setView('errors');
    else if (location.pathname === '/revision') _setView('revision');
    else if (location.pathname === '/revision/session') _setView('revision_session');
    else if (location.pathname === '/exams') _setView('exams');
    else if (location.pathname === '/exams/session') _setView('exam_session');
    else if (location.pathname === '/settings') _setView('settings');
  }, [location.pathname]);

  const setView = (v: ViewState | 'admin') => {
    if (v === 'admin') {
      navigate('/admin');
      return;
    }
    if (isDemo && (v === 'exams' || v === 'exam_session' || v === 'retake_past_exams' || v === 'simulation_config' || v === 'simulation_session')) {
      askConfirmation(
        "Accès Premium Requis",
        "Cette fonctionnalité est réservée aux membres premium. Voulez-vous débloquer l'accès complet ?",
        () => window.open('https://wa.me/237656534563', '_blank')
      );
      return;
    }
    _setView(v as ViewState);
    if (v === 'dashboard') navigate('/');
    else if (v === 'simulation') navigate('/simulation');
    else if (v === 'books') navigate('/training');
    else if (v === 'chapters') navigate('/training/chapters');
    else if (v === 'blocks') navigate('/training/blocks');
    else if (v === 'training') navigate('/training/session');
    else if (v === 'simulation_config') navigate('/simulation/config');
    else if (v === 'simulation_session') navigate('/simulation/session');
    else if (v === 'planning') navigate('/planning');
    else if (v === 'progression') navigate('/progression');
    else if (v === 'errors') navigate('/errors');
    else if (v === 'revision') navigate('/revision');
    else if (v === 'revision_session') navigate('/revision/session');
    else if (v === 'exams') navigate('/exams');
    else if (v === 'exam_session') navigate('/exams/session');
    else if (v === 'settings') navigate('/settings');
  };
  const [books, setBooks] = useState<any[]>([]);
  const [selectedBook, setSelectedBook] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
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
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string | string[]>>({});
  const [validated, setValidated] = useState<Record<number, boolean>>({});
  const [qrocEvaluations, setQrocEvaluations] = useState<Record<number, {
    loading?: boolean;
    disabled?: boolean;
    score?: number;
    strengths?: string[];
    missingPoints?: string[];
    improvedAnswer?: string;
    feedback?: string;
    error?: string;
  }>>({});
  const [qrocStats, setQrocStats] = useState<{
    count: number;
    scoreSum: number;
    avgScore: number;
    maxScore: number;
    history: { date: string; score: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Revision State ---
  const [revisionMode, setRevisionMode] = useState<'fiches' | 'videos' | 'mix' | 'mindmap'>('fiches');
  const [revisionItems, setRevisionItems] = useState<any[]>([]); // Array of { type: 'fiche' | 'video' | 'qcm' | 'mindmap', url?: string, question?: any, tree?: any }
  const [revisionIdx, setRevisionIdx] = useState(0);
  const [revisionSelection, setRevisionSelection] = useState<{books: string[], chapters: string[], blocks: string[]}>({books: [], chapters: [], blocks: []});

  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  
  // Fiche Modal State
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [courseImagesVisible, setCourseImagesVisible] = useState<string[]>([]);
  const [currentCourseIndex, setCurrentCourseIndex] = useState(0);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);
  const [showMindMapModal, setShowMindMapModal] = useState(false);
  const [currentMindMapTree, setCurrentMindMapTree] = useState<any | null>(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(null);

  // Gamification State
  const [userProgress, setUserProgress] = useState<any>(null);
  const [userPlanning, setUserPlanning] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [dailyProgress, setDailyProgress] = useState<any>(null);
  const [activePlan, setActivePlan] = useState<any>(null);
  const [isPlanSession, setIsPlanSession] = useState(false);
  const [isErrorSession, setIsErrorSession] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressionSubView, setProgressionSubView] = useState<'internal' | 'leaderboard'>('internal');
  const [internalSubView, setInternalSubView] = useState<'badges' | 'objectifs' | 'livres'>('objectifs');
  const [booksTotalQuestions, setBooksTotalQuestions] = useState<Record<string, number>>({});
  const [chaptersTotalQuestions, setChaptersTotalQuestions] = useState<Record<string, number>>({});
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<string | null>(null);
  const [allChapters, setAllChapters] = useState<any[]>([]);
  const [seriesQ, setSeriesQ] = useState<any[]>([]);
  const [userExamHistory, setUserExamHistory] = useState<any[]>([]);
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<any[]>([]);

  // Planner Config State
  const [plannerConfig, setPlannerConfig] = useState({
    endDate: '',
    selectedBooks: [] as string[],
    selectedChapters: [] as string[],
    selectedBlocks: [] as string[],
  });
  const [plannerAvailableChapters, setPlannerAvailableChapters] = useState<any[]>([]);
  const [plannerAvailableBlocks, setPlannerAvailableBlocks] = useState<any[]>([]);

  // Errors State
  const [userErrors, setUserErrors] = useState<any[]>([]);
  const [plannerAvailableQuestionsCount, setPlannerAvailableQuestionsCount] = useState(0);
  const [allExams, setAllExams] = useState<any[]>([]);
  const [nextExam, setNextExam] = useState<any>(null);
  const [ongoingExam, setOngoingExam] = useState<any>(null);
  const [lastFinishedExam, setLastFinishedExam] = useState<any>(null);
  const [lastExamLeaderboard, setLastExamLeaderboard] = useState<any[]>([]);
  const [userLastExamRank, setUserLastExamRank] = useState<number | null>(null);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Guide State
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [tutorialStepsCompleted, setTutorialStepsCompleted] = useState<string[]>([]);
  const isInitializingProgress = useRef<string | null>(null);
  const [isResettingTutorial, setIsResettingTutorial] = useState(false);
  const [globalStats, setGlobalStats] = useState<any>(null);

  // Simulation Config State
  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig>({
    durationMinutes: 60,
    questionCount: 0,
    selectedBooks: [],
    selectedChapters: [],
    selectedBlocks: [],
    drawMode: 'random'
  });

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'stats', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        setGlobalStats(docSnap.data());
      } else if (isAdmin) {
        // Initialize stats if you're an admin and they don't exist
        setDoc(doc(db, 'stats', 'global'), { 
          testClicks: 0, 
          totalUsers: 0, 
          lastUpdated: new Date().toISOString() 
        }).catch(err => console.error("Error initializing stats:", err));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'stats/global');
    });

    // Count user if not already counted this session
    const countUser = async () => {
      if (isDemo || !userId) return;
      const hasBeenCounted = sessionStorage.getItem('ais_user_counted');
      if (!hasBeenCounted) {
        try {
          const statsRef = doc(db, 'stats', 'global');
          await setDoc(statsRef, {
            totalUsers: increment(1),
            lastUpdated: new Date().toISOString()
          }, { merge: true });

          // Update user profile to mark as logged in
          const userRef = doc(db, 'users', userId);
          await updateDoc(userRef, { 
            hasLoggedIn: true,
            lastLogin: serverTimestamp()
          });

          // Log connection history
          await addDoc(collection(db, 'connections'), {
            userId: userId,
            displayName: user?.displayName || 'Utilisateur',
            username: user?.username || 'Inconnu',
            timestamp: serverTimestamp(),
            filiere: user?.filiere || 'N/A',
            niveau: user?.niveau || 'N/A'
          });

          sessionStorage.setItem('ais_user_counted', 'true');
        } catch (e) {
          console.error("Error counting user", e);
        }
      }
    };
    countUser();

    return () => unsub();
  }, [isAdmin, userId, isDemo]);

  // Simulation Available State
  const [simAvailableChapters, setSimAvailableChapters] = useState<any[]>([]);
  const [simAvailableBlocks, setSimAvailableBlocks] = useState<any[]>([]);
  const [simAvailableQuestionsCount, setSimAvailableQuestionsCount] = useState(0);

  useEffect(() => {
    if (userId && !isDemo) {
      const unsub = onSnapshot(doc(db, 'users', userId), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setOnboardingCompleted(data.onboardingCompleted ?? false);
          setTutorialStepsCompleted(data.tutorialStepsCompleted || []);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${userId}`);
      });

      const unsubQroc = onSnapshot(doc(db, 'users', userId, 'stats', 'qrocStats'), (docSnap) => {
        if (docSnap.exists()) {
          setQrocStats(docSnap.data() as any);
        }
      }, (err) => {
        console.warn("Failed to fetch qroc stats", err);
      });

      return () => {
        unsub();
        unsubQroc();
      };
    } else if (isDemo) {
      // For demo users, we initially assume everything is completed to avoid distractions
      // But we allow overriding it via handleRestartTutorial
      if (onboardingCompleted === null) {
        setOnboardingCompleted(true);
        setTutorialStepsCompleted(['step_training', 'step_simulation', 'step_planning', 'step_errors', 'ctx_simulation', 'ctx_planning', 'ctx_exams']);
      }
    }
  }, [userId, isDemo]);

  const handleCompleteOnboarding = async () => {
    if (!userId) return;
    if (isDemo) {
      setOnboardingCompleted(true);
      return;
    }
    try {
      await updateDoc(doc(db, 'users', userId), { onboardingCompleted: true });
      setOnboardingCompleted(true);
    } catch (e) {
      console.error("Error updating onboarding", e);
    }
  };

  const handleCompleteTutorialStep = async (stepId: string) => {
    if (!userId) return;
    if (isDemo) {
      setTutorialStepsCompleted(prev => [...prev, stepId]);
      return;
    }
    try {
      const newSteps = [...tutorialStepsCompleted, stepId];
      await updateDoc(doc(db, 'users', userId), { tutorialStepsCompleted: newSteps });
      setTutorialStepsCompleted(newSteps);
    } catch (e) {
      console.error("Error updating tutorial step", e);
    }
  };

  const handleSkipAllTutorial = async () => {
    if (!userId) return;
    const allSteps = ['step_training', 'step_simulation', 'step_planning', 'step_errors', 'ctx_simulation', 'ctx_planning', 'ctx_exams'];
    if (isDemo) {
      setOnboardingCompleted(true);
      setTutorialStepsCompleted(allSteps);
      return;
    }
    try {
      await updateDoc(doc(db, 'users', userId), { 
        onboardingCompleted: true,
        tutorialStepsCompleted: allSteps 
      });
      setOnboardingCompleted(true);
      setTutorialStepsCompleted(allSteps);
    } catch (e) {
      console.error("Error skipping tutorial", e);
    }
  };

  const handleRestartTutorial = async () => {
    if (!userId || isResettingTutorial) return;
    setIsResettingTutorial(true);
    
    if (isDemo) {
      setOnboardingCompleted(false);
      setTutorialStepsCompleted([]);
      setView('dashboard');
      setIsResettingTutorial(false);
      return;
    }
    try {
      await updateDoc(doc(db, 'users', userId), { 
        onboardingCompleted: false,
        tutorialStepsCompleted: [] 
      });
      // State will be updated via onSnapshot listener for non-demo users
      setView('dashboard');
    } catch (e) {
      console.error("Error restarting tutorial", e);
    } finally {
      setIsResettingTutorial(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'chapters'), (snap) => {
      const allData = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      // Global Filtering
      const filtered = allData.filter(c => {
        if (isAdmin) return true;
        const f = c.filiere || 'ECN';
        const n = c.niveau || 'ALL';
        return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
      });
      setAllChapters(filtered);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'chapters');
    });
    return () => unsubscribe();
  }, [userFiliere, userNiveau]);

  const [allBlocks, setAllBlocks] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'blocks'), (snap) => {
      setAllBlocks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'blocks');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const calculateTotals = () => {
      if (books.length === 0 || allChapters.length === 0 || allBlocks.length === 0) return;
      
      const bookTotals: Record<string, number> = {};
      const chapterTotals: Record<string, number> = {};
      
      // Index blocks by chapterId for fast lookup (O(N) instead of O(N*M))
      const blocksByChapter: Record<string, any[]> = {};
      allBlocks.forEach(b => {
        if (!blocksByChapter[b.chapterId]) blocksByChapter[b.chapterId] = [];
        blocksByChapter[b.chapterId].push(b);
      });
      
      allChapters.forEach(chapter => {
        const chapterBlocks = blocksByChapter[chapter.id] || [];
        const total = chapterBlocks.reduce((sum, b: any) => sum + (b.questionsCount || 0), 0);
        chapterTotals[chapter.id] = total;
      });

      books.forEach(book => {
        const bookChapters = allChapters.filter((c: any) => c.bookId === book.id);
        const total = bookChapters.reduce((sum, c: any) => sum + (chapterTotals[c.id] || 0), 0);
        bookTotals[book.id] = total;
      });
      
      setBooksTotalQuestions(bookTotals);
      setChaptersTotalQuestions(chapterTotals);
    };
    
    calculateTotals();
  }, [books, allChapters, allBlocks]);

  // Optimized Leaderboard Fetching
  const fetchLeaderboardData = async () => {
    if (!userId) return;
    try {
      // 1. User Exam History
      const attemptsSnap = await getDocs(query(collection(db, 'examAttempts'), where('userId', '==', userId)));
      const attemptsData = attemptsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Fetch all exam titles once to avoid per-attempt getDoc
      const examIds = [...new Set(attemptsData.map((a: any) => a.examId))];
      const examMap : Record<string, string> = {};
      
      await Promise.all(examIds.map(async (id) => {
        try {
          const d = await getDoc(doc(db, 'exams', id as string));
          if (d.exists()) examMap[id as string] = d.data().title;
        } catch(e) {
          console.warn("Could not fetch exam " + id, e);
        }
      }));

      // To avoid per-attempt rank queries (N+1), we just show the score for now
      // Ranks should ideally be pre-calculated or fetched in a single query per exam
      const historySummary = attemptsData.map((attempt: any) => ({
        ...attempt,
        examTitle: examMap[attempt.examId] || 'Examen inconnu',
        rank: attempt.rank || '-' // Use pre-calculated rank if it exists in DB
      }));
      
      setUserExamHistory(historySummary.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));

      // 2. Weekly Leaderboard
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const weeklySnap = await getDocs(query(
        collection(db, 'examAttempts'), 
        where('createdAt', '>=', sevenDaysAgo.toISOString())
      ));
      
      const weeklyData = weeklySnap.docs.map(d => d.data());
      // Group by user and take best score
      const userBestScores: { [key: string]: any } = {};
      weeklyData.forEach((attempt: any) => {
        if (!userBestScores[attempt.userId] || attempt.score > userBestScores[attempt.userId].score) {
          userBestScores[attempt.userId] = attempt;
        }
      });
      
      const sortedWeekly = Object.values(userBestScores).sort((a, b) => b.score - a.score);
      setWeeklyLeaderboard(sortedWeekly);
    } catch (err) {
      console.warn("Could not fetch leaderboard data (client may be offline).");
    }
  };

  useEffect(() => {
    if (userId) fetchLeaderboardData();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    if (isDemo) {
      // For demo users, initialize everything in memory only
      const initialProgress = {
        answeredQuestions: 0,
        correctAnswers: 0,
        incorrectAnswers: 0,
        accuracy: 0,
        currentStreak: 0,
        lastActiveDate: null,
        qcmAnswered: 0,
        qcmCorrect: 0,
        vraiFauxAnswered: 0,
        vraiFauxCorrect: 0,
        qrocAnswered: 0,
        badges: [],
        byBook: {},
        byChapter: {},
        byBlock: {}
      };
      setUserProgress(initialProgress);
      setUserPlanning({ dailyTarget: 20 });
      setDailyProgress({ done: 0, target: 20 });
      setUserErrors([]);
      setPlans([]);
      return;
    }

    const qAllPlans = query(collection(db, 'studyPlans'), where('userId', '==', userId));
    const unsubPlans = onSnapshot(qAllPlans, (snap) => {
      setPlans(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'studyPlans');
    });

    const unsubProgress = onSnapshot(doc(db, 'userProgress', userId), (docSnap) => {
      if (docSnap.exists()) {
        setUserProgress(docSnap.data());
        isInitializingProgress.current = null;
      } else {
        // Initialize progress only once per session/userId to avoid loops
        if (isInitializingProgress.current === userId) return;
        isInitializingProgress.current = userId;

        const initialProgress = {
          answeredQuestions: 0,
          correctAnswers: 0,
          incorrectAnswers: 0,
          accuracy: 0,
          currentStreak: 0,
          lastActiveDate: null,
          fichesViewed: 0,
          videosViewed: 0,
          qcmAnswered: 0,
          qcmCorrect: 0,
          vraiFauxAnswered: 0,
          vraiFauxCorrect: 0,
          qrocAnswered: 0,
          badges: [],
          byBook: {},
          byChapter: {},
          byBlock: {}
        };
        setUserProgress(initialProgress);
        setDoc(doc(db, 'userProgress', userId), initialProgress).catch(err => {
          console.error("Error initializing progress:", err);
          isInitializingProgress.current = null;
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `userProgress/${userId}`);
    });

    const unsubPlanning = onSnapshot(doc(db, 'userPlanning', userId), (doc) => {
      if (doc.exists()) setUserPlanning(doc.data());
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `userPlanning/${userId}`);
    });

    const today = new Date().toISOString().split('T')[0];
    const unsubDaily = onSnapshot(doc(db, 'dailyProgress', userId, 'dates', today), (doc) => {
      if (doc.exists()) setDailyProgress(doc.data());
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `dailyProgress/${userId}/dates/${today}`);
    });

    const qActivePlan = query(collection(db, 'studyPlans'), where('userId', '==', userId), where('status', '==', 'active'));
    const unsubActivePlan = onSnapshot(qActivePlan, (snap) => {
      if (!snap.empty) {
        setActivePlan({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        setActivePlan(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'studyPlans');
    });

    const qErrors = query(collection(db, 'userErrors'), where('userId', '==', userId));
    const unsubErrors = onSnapshot(qErrors, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort by timestamp descending
      data.sort((a: any, b: any) => {
        const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return dateB - dateA;
      });
      console.log("Errors fetched from Firebase:", data);
      setUserErrors(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'userErrors');
    });

    const unsubExams = onSnapshot(query(collection(db, 'exams'), orderBy('startTime', 'asc')), (snap) => {
      const exams = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setAllExams(exams);
      
      const now = new Date();
      let foundOngoing = null;
      let foundNext = null;
      let foundLastFinished = null;

      for (const exam of exams) {
        const startTime = new Date(exam.startTime);
        const endTime = new Date(startTime.getTime() + (exam.durationMinutes || 60) * 60000);

        if (now >= startTime && now <= endTime) {
          foundOngoing = exam;
        } else if (now < startTime) {
          if (!foundNext) foundNext = exam;
        } else if (now > endTime) {
          // Since exams are ordered by startTime asc, the last one we find that is finished
          // will be the most recent finished exam
          foundLastFinished = exam;
        }
      }

      setOngoingExam(foundOngoing);
      setNextExam(foundNext);
      setLastFinishedExam(foundLastFinished);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'exams');
    });

    const unsubSeriesQ = onSnapshot(collection(db, 'seriesQ'), (snap) => {
      setSeriesQ(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'seriesQ');
    });

    return () => {
      unsubPlans();
      unsubProgress();
      unsubPlanning();
      unsubDaily();
      unsubActivePlan();
      unsubErrors();
      unsubExams();
      unsubSeriesQ();
    };
  }, [userId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnlargedImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const recordViewedMaterial = async (type: 'fiche' | 'video') => {
    if (!userId || isDemo) return;
    const progress = userProgress || { fichesViewed: 0, videosViewed: 0 };
    const field = type === 'fiche' ? 'fichesViewed' : 'videosViewed';
    const newVal = (Number(progress[field]) || 0) + 1;
    
    try {
      await updateDoc(doc(db, 'userProgress', userId), {
        [field]: newVal
      });
    } catch (e) {
      console.error("Error recording viewed material", e);
    }
  };

  const handleStartRevision = async (mode: 'fiches' | 'videos' | 'mix' | 'mindmap') => {
    setLoading(true);
    setError(null);
    try {
      const { books: selectedBooks, chapters: selectedChapters, blocks: selectedBlocks } = revisionSelection;
      if (selectedBooks.length === 0) {
        setError("Veuillez sélectionner au moins un livre.");
        setLoading(false);
        return;
      }

      // Handle Virtual Serie Q
      if (selectedBooks.includes('serie_q_virtual')) {
        const items: any[] = [];
        const filteredSeries = seriesQ.filter(s => s.filiere === userFiliere || s.filiere === 'ALL');
        
        filteredSeries.forEach(s => {
          if (mode === 'fiches' || mode === 'mix') {
            items.push({ type: 'fiche', url: s.imageUrl, title: s.title });
          }
          if (mode === 'videos' || mode === 'mix') {
            items.push({ type: 'video', url: s.videoUrl, title: s.title });
          }
        });

        if (items.length === 0) {
          setError("Aucun contenu 'Série Q' trouvé.");
          setLoading(false);
          return;
        }

        setRevisionItems(items);
        setRevisionIdx(0);
        setView('revision_session');
        setLoading(false);
        return;
      }

      let allQuestions: any[] = [];
      
      const fetchSelection = async () => {
        let q: any[] = [];
        if (selectedBlocks.length > 0) {
          // Firestore 'in' query limit 30
          for (let i = 0; i < selectedBlocks.length; i += 30) {
            const chunk = selectedBlocks.slice(i, i + 30);
            const snap = await getDocs(query(collection(db, 'questions'), where('blockId', 'in', chunk)));
            q = [...q, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
          }
        } else if (selectedChapters.length > 0) {
          for (let i = 0; i < selectedChapters.length; i += 30) {
            const chunk = selectedChapters.slice(i, i + 30);
            const snap = await getDocs(query(collection(db, 'questions'), where('chapterId', 'in', chunk)));
            q = [...q, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
          }
        } else {
          for (const bid of selectedBooks) {
            const chSnap = await getDocs(query(collection(db, 'chapters'), where('bookId', '==', bid)));
            const cids = chSnap.docs.map(d => d.id);
            for (let i = 0; i < cids.length; i += 30) {
              const chunk = cids.slice(i, i + 30);
              const snap = await getDocs(query(collection(db, 'questions'), where('chapterId', 'in', chunk)));
              q = [...q, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
            }
          }
        }
        return q;
      };

      const rawQuestions = await fetchSelection();
      const items: any[] = [];
      
      if (mode === 'fiches') {
        const ficheUrls = new Set<string>();
        rawQuestions.forEach(q => {
          if (q.courseImages) q.courseImages.forEach((url: string) => ficheUrls.add(url));
        });
        
        // Also include block-level fiches
        const bids = selectedBlocks.length > 0 ? selectedBlocks : [...new Set(rawQuestions.map(q => q.blockId))].filter(Boolean);
        for (let i = 0; i < bids.length; i += 30) {
          const chunk = bids.slice(i, i + 30);
          const snap = await getDocs(query(collection(db, 'blocks'), where('__name__', 'in', chunk)));
          snap.docs.forEach(d => {
            const data = d.data();
            if (data.ficheImageUrl) ficheUrls.add(data.ficheImageUrl);
            if (data.fichePdfUrl) items.push({ type: 'pdf', url: data.fichePdfUrl, blockTitle: data.blockTitle });
          });
        }

        ficheUrls.forEach(url => items.push({ type: 'fiche', url }));
      } else if (mode === 'videos') {
        const videoItems: any[] = [];
        const seenVideos = new Set<string>();
        
        rawQuestions.forEach(q => {
          if (q.courseVideos) q.courseVideos.forEach((url: string) => {
            if (!seenVideos.has(url)) {
              videoItems.push({ type: 'video', url });
              seenVideos.add(url);
            }
          });
        });

        // Block videos
        const bids = selectedBlocks.length > 0 ? selectedBlocks : [...new Set(rawQuestions.map(q => q.blockId))].filter(Boolean);
        for (let i = 0; i < bids.length; i += 30) {
          const chunk = bids.slice(i, i + 30);
          const snap = await getDocs(query(collection(db, 'blocks'), where('__name__', 'in', chunk)));
          snap.docs.forEach(d => {
            const data = d.data();
            if (data.videoUrl && !seenVideos.has(data.videoUrl)) {
              videoItems.push({ type: 'video', url: data.videoUrl });
              seenVideos.add(data.videoUrl);
            }
          });
        }
        items.push(...videoItems);
      } else if (mode === 'mindmap') {
        const bids = selectedBlocks.length > 0 ? selectedBlocks : [...new Set(rawQuestions.map(q => q.blockId))].filter(Boolean);
        for (let i = 0; i < bids.length; i += 30) {
          const chunk = bids.slice(i, i + 30);
          const snap = await getDocs(query(collection(db, 'blocks'), where('__name__', 'in', chunk)));
          snap.docs.forEach(d => {
            const data = d.data();
            if (data.mindMapText) {
              const tree = parseMindMapText(data.mindMapText);
              if (tree) {
                items.push({ type: 'mindmap', tree, blockId: d.id, blockTitle: data.blockTitle });
              }
            }
          });
        }
        // If no specifically set mindmap, generate one sample for demo if no items found
        if (items.length === 0 && rawQuestions.length > 0) {
             const sampleText = `# ${rawQuestions[0].groupTitle || 'Sujet du cours'}
1. Anatomie Physiologie
  - Structure cellulaire
    * Membrane plasmique
    * Noyau
  - Métabolisme
    * Glycolyse
2. Pathologies
  - Inflammations
    * Oedème
  - Infections
    * Virales
    * Bactériennes`;
             const tree = parseMindMapText(sampleText);
             items.push({ type: 'mindmap', tree, blockTitle: 'Exemple de Carte Mentale' });
        }
      } else if (mode === 'mix') {
        const seenVideos = new Set<string>();
        const seenFiches = new Set<string>();
        
        rawQuestions.forEach(q => {
          const hasFiche = q.courseImages && q.courseImages.length > 0;
          const hasVideo = q.courseVideos && q.courseVideos.length > 0;
          
          if (hasFiche) q.courseImages.forEach((url: string) => {
            items.push({ type: 'fiche', url, questionId: q.id });
            seenFiches.add(url);
          });
          if (hasVideo) q.courseVideos.forEach((url: string) => {
            items.push({ type: 'video', url, questionId: q.id });
            seenVideos.add(url);
          });
          if (hasFiche || hasVideo) {
            items.push({ type: 'qcm', question: q });
          }
        });

        // Add those from blocks too
        const bids = selectedBlocks.length > 0 ? selectedBlocks : [...new Set(rawQuestions.map(q => q.blockId))].filter(Boolean);
        for (let i = 0; i < bids.length; i += 30) {
          const chunk = bids.slice(i, i + 30);
          const snap = await getDocs(query(collection(db, 'blocks'), where('__name__', 'in', chunk)));
          snap.docs.forEach(d => {
            const data = d.data();
            if (data.ficheImageUrl && !seenFiches.has(data.ficheImageUrl)) {
              items.push({ type: 'fiche', url: data.ficheImageUrl });
              seenFiches.add(data.ficheImageUrl);
            }
            if (data.fichePdfUrl) {
              items.push({ type: 'pdf', url: data.fichePdfUrl, blockTitle: data.blockTitle });
            }
            if (data.videoUrl && !seenVideos.has(data.videoUrl)) {
              items.push({ type: 'video', url: data.videoUrl });
              seenVideos.add(data.videoUrl);
            }
          });
        }
      }

      if (items.length === 0) {
        setError("Aucun contenu de révision trouvé pour cette sélection.");
      } else {
        setRevisionItems(items);
        setRevisionIdx(0);
        setRevisionMode(mode);
        setView('revision_session');
      }
    } catch (err: any) {
      console.error(err);
      setError("Erreur lors de la préparation de la révision.");
    } finally {
      setLoading(false);
    }
  };

  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const askConfirmation = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModalConfig({ title, message, onConfirm });
    setShowConfirmModal(true);
  };

  const handleErrorTracking = async (question: any, selectedAnswer: string | string[], isCorrect: boolean) => {
    if (!userId || !question) return;
    
    if (isDemo) {
      // Local error tracking for demo users
      if (!isCorrect) {
        const newError = {
          id: 'demo-error-' + Date.now(),
          userId,
          questionId: question.id,
          chapterId: question.chapterId || null,
          blockId: question.blockId || null,
          selectedAnswer,
          correctAnswer: question.answer?.correctLetter || null,
          timestamp: new Date().toISOString()
        };
        setUserErrors(prev => [newError, ...prev]);
      } else {
        setUserErrors(prev => prev.filter(e => e.questionId !== question.id));
      }
      return;
    }

    console.log("SAVE ERROR TRIGGERED", { questionId: question.id, isCorrect });

    try {
      const errorQuery = query(
        collection(db, 'userErrors'), 
        where('userId', '==', userId), 
        where('questionId', '==', question.id)
      );
      const errorSnap = await getDocs(errorQuery);
      
      if (isCorrect) {
        // Remove from errors if exists
        if (!errorSnap.empty) {
          console.log("Removing error from Firebase", question.id);
          errorSnap.docs.forEach(async (d) => {
            await deleteDoc(doc(db, 'userErrors', d.id));
          });
        }
      } else {
        // Add to errors if not exists
        if (errorSnap.empty) {
          console.log("Saving new error to Firebase", question.id);
          await addDoc(collection(db, 'userErrors'), {
            userId,
            questionId: question.id,
            chapterId: question.chapterId || null,
            blockId: question.blockId || null,
            selectedAnswer,
            correctAnswer: question.answer?.correctLetter || null,
            timestamp: new Date().toISOString()
          });
        } else {
          // Update existing error with new selected answer and timestamp
          console.log("Updating existing error in Firebase", question.id);
          const errorDoc = errorSnap.docs[0];
          await updateDoc(doc(db, 'userErrors', errorDoc.id), {
            selectedAnswer,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (e) {
      console.error("Error tracking user error", e);
    }
  };

  const updateUserProgress = async (isCorrect: boolean, xp: number = 0, question: any = null, isSessionEnd: boolean = false) => {
    if (!userId || !userProgress) return;
    
    if (isDemo) {
      setDemoQuestionsCount(prev => prev + 1);
    }
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const currentProgress = { ...userProgress };
    
    // Stats
    currentProgress.answeredQuestions += 1;
    if (isCorrect) {
      currentProgress.correctAnswers += 1;
    } else {
      currentProgress.incorrectAnswers += 1;
    }
    currentProgress.accuracy = currentProgress.correctAnswers / currentProgress.answeredQuestions;

    const questionType = question?.type || 'QCM';
    if (questionType === 'QROC') {
      currentProgress.qrocAnswered = (currentProgress.qrocAnswered || 0) + 1;
    } else if (questionType === 'VRAI_FAUX') {
      currentProgress.vraiFauxAnswered = (currentProgress.vraiFauxAnswered || 0) + 1;
      if (isCorrect) {
        currentProgress.vraiFauxCorrect = (currentProgress.vraiFauxCorrect || 0) + 1;
      }
    } else {
      currentProgress.qcmAnswered = (currentProgress.qcmAnswered || 0) + 1;
      if (isCorrect) {
        currentProgress.qcmCorrect = (currentProgress.qcmCorrect || 0) + 1;
      }
    }

    // Streak
    if (currentProgress.lastActiveDate === yesterday) {
      currentProgress.currentStreak += 1;
    } else if (currentProgress.lastActiveDate !== today) {
      currentProgress.currentStreak = 1;
    }
    currentProgress.lastActiveDate = today;

    // Badges
    const newBadges = [...(currentProgress.badges || [])];
    if (currentProgress.answeredQuestions >= 100 && !newBadges.includes('first_100_questions')) {
      newBadges.push('first_100_questions');
    }
    if (currentProgress.currentStreak >= 7 && !newBadges.includes('7_day_streak')) {
      newBadges.push('7_day_streak');
    }
    if (currentProgress.accuracy >= 0.8 && currentProgress.answeredQuestions >= 100 && !newBadges.includes('high_accuracy')) {
      newBadges.push('high_accuracy');
    }
    currentProgress.badges = newBadges;

    // Update Firestore
    if (isDemo) {
      setUserProgress(currentProgress);
      setDailyProgress(prev => ({ ...prev, done: (prev?.done || 0) + 1 }));
      return;
    }

    try {
      const batch = writeBatch(db);
      
      // 1. Update userProgress
      batch.update(doc(db, 'userProgress', userId), currentProgress);
      
      // 2. Update Daily Progress
      const dailyRef = doc(db, 'dailyProgress', userId, 'dates', today);
      const currentDaily = dailyProgress || { done: 0, target: userPlanning?.dailyTarget || 0 };
      batch.set(dailyRef, { ...currentDaily, done: currentDaily.done + 1 });

      // 3. Update Planner Plans (StudyPlans)
      if (question && question.blockId) {
        const qPlans = query(collection(db, 'studyPlans'), where('userId', '==', userId), where('status', '==', 'active'));
        const plansSnap = await getDocs(qPlans);
        plansSnap.docs.forEach(docSnap => {
          const plan = docSnap.data();
          const targetBlocks = plan.blocks || plan.selectedBlocks || [];
          if (targetBlocks.includes(question.blockId)) {
            const planProgress = {
              completedQuestions: 0,
              dailyProgress: {},
              streak: 0,
              lastActiveDate: null,
              ...(plan.progress || {})
            };
            if (!planProgress.dailyProgress) planProgress.dailyProgress = {};
            
            planProgress.completedQuestions += 1;
            planProgress.dailyProgress[today] = (planProgress.dailyProgress[today] || 0) + 1;
            
            const targetDaily = plan.dailyTarget || plan.questionsPerDay || 20;
            if (planProgress.dailyProgress[today] >= targetDaily) {
              if (planProgress.lastActiveDate === yesterday) {
                planProgress.streak += 1;
              } else if (planProgress.lastActiveDate !== today) {
                planProgress.streak = 1;
              }
              planProgress.lastActiveDate = today;
            }
            
            batch.update(docSnap.ref, { progress: planProgress });
          }
        });
      }
      
      await batch.commit();
    } catch (err) {
      console.error("Error updating progress:", err);
    }
  };

  const updateUserProgressBatch = async (results: { isCorrect: boolean, question?: any }[], isSessionEnd: boolean = false) => {
    if (!userId || !userProgress) return;

    if (isDemo) {
      setDemoQuestionsCount(prev => prev + results.length);
    }
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const currentProgress = { ...userProgress };
    
    let correct = 0;
    let incorrect = 0;
    
    results.forEach(r => {
      if (r.isCorrect) {
        correct++;
      } else {
        incorrect++;
      }

      const questionType = r?.question?.type || 'QCM';
      if (questionType === 'QROC') {
        currentProgress.qrocAnswered = (currentProgress.qrocAnswered || 0) + 1;
      } else if (questionType === 'VRAI_FAUX') {
        currentProgress.vraiFauxAnswered = (currentProgress.vraiFauxAnswered || 0) + 1;
        if (r.isCorrect) {
          currentProgress.vraiFauxCorrect = (currentProgress.vraiFauxCorrect || 0) + 1;
        }
      } else {
        currentProgress.qcmAnswered = (currentProgress.qcmAnswered || 0) + 1;
        if (r.isCorrect) {
          currentProgress.qcmCorrect = (currentProgress.qcmCorrect || 0) + 1;
        }
      }
    });

    currentProgress.answeredQuestions += results.length;
    currentProgress.correctAnswers += correct;
    currentProgress.incorrectAnswers += incorrect;
    currentProgress.accuracy = currentProgress.correctAnswers / currentProgress.answeredQuestions;

    // Track per-book and per-chapter progress
    const byBook = currentProgress.byBook || {};
    const byChapter = currentProgress.byChapter || {};
    results.forEach(r => {
      if (r.question && r.question.chapterId) {
        // Book progress
        const chapter = allChapters.find(c => c.id === r.question.chapterId);
        if (chapter && chapter.bookId) {
          if (!byBook[chapter.bookId]) {
            byBook[chapter.bookId] = { answered: 0 };
          }
          byBook[chapter.bookId].answered += 1;
        }
        // Chapter progress
        if (!byChapter[r.question.chapterId]) {
          byChapter[r.question.chapterId] = { answered: 0 };
        }
        byChapter[r.question.chapterId].answered += 1;
      }
    });
    currentProgress.byBook = byBook;
    currentProgress.byChapter = byChapter;

    if (currentProgress.lastActiveDate === yesterday) {
      currentProgress.currentStreak += 1;
    } else if (currentProgress.lastActiveDate !== today) {
      currentProgress.currentStreak = 1;
    }
    currentProgress.lastActiveDate = today;

    const newBadges = [...(currentProgress.badges || [])];
    if (currentProgress.answeredQuestions >= 100 && !newBadges.includes('first_100_questions')) {
      newBadges.push('first_100_questions');
    }
    if (currentProgress.currentStreak >= 7 && !newBadges.includes('7_day_streak')) {
      newBadges.push('7_day_streak');
    }
    if (currentProgress.accuracy >= 0.8 && currentProgress.answeredQuestions >= 100 && !newBadges.includes('high_accuracy')) {
      newBadges.push('high_accuracy');
    }
    currentProgress.badges = newBadges;

    if (isDemo) {
      setUserProgress(currentProgress);
      setDailyProgress(prev => ({ ...prev, done: (prev?.done || 0) + results.length }));
      return;
    }

    try {
      const batch = writeBatch(db);
      
      // 1. Update userProgress
      batch.update(doc(db, 'userProgress', userId), currentProgress);
      
      // 2. Update Daily Progress
      const dailyRef = doc(db, 'dailyProgress', userId, 'dates', today);
      const currentDaily = dailyProgress || { done: 0, target: userPlanning?.dailyTarget || 0 };
      batch.set(dailyRef, { ...currentDaily, done: currentDaily.done + results.length });

      // 3. Update Planner Plans (StudyPlans)
      const qPlans = query(collection(db, 'studyPlans'), where('userId', '==', userId), where('status', '==', 'active'));
      const plansSnap = await getDocs(qPlans);
      
      plansSnap.docs.forEach(docSnap => {
        const plan = docSnap.data();
        let questionsForPlan = 0;
        const targetBlocks = plan.blocks || plan.selectedBlocks || [];
        
        results.forEach(r => {
          if (r.question && r.question.blockId && targetBlocks.includes(r.question.blockId)) {
            questionsForPlan++;
          }
        });

        if (questionsForPlan > 0) {
          const planProgress = {
            completedQuestions: 0,
            dailyProgress: {},
            streak: 0,
            lastActiveDate: null,
            ...(plan.progress || {})
          };
          if (!planProgress.dailyProgress) planProgress.dailyProgress = {};
          
          planProgress.completedQuestions += questionsForPlan;
          planProgress.dailyProgress[today] = (planProgress.dailyProgress[today] || 0) + questionsForPlan;
          
          const targetDaily = plan.dailyTarget || plan.questionsPerDay || 20;
          if (planProgress.dailyProgress[today] >= targetDaily) {
            if (planProgress.lastActiveDate === yesterday) {
              planProgress.streak += 1;
            } else if (planProgress.lastActiveDate !== today) {
              planProgress.streak = 1;
            }
            planProgress.lastActiveDate = today;
          }
          
          batch.update(docSnap.ref, { progress: planProgress });
        }
      });
      
      await batch.commit();
    } catch (err) {
      console.error("Error updating progress batch:", err);
    }
  };

  const fetchBooks = async () => {
    setLoading(true);
    setError(null);
    try {
      const booksSnap = await getDocs(query(collection(db, 'books'), orderBy('name', 'asc')));
      const booksData = booksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      
      // Global Filtering
      const filtered = booksData.filter(b => {
        if (isAdmin) return true;
        const f = b.filiere || 'ECN';
        const n = b.niveau || 'ALL';
        return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
      });
      
      setBooks(filtered);
    } catch (err: any) {
      setError("Impossible de charger les livres.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'books'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const booksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      
      // Global Filtering
      const filtered = booksData.filter(b => {
        if (isAdmin) return true;
        const f = b.filiere || 'ECN';
        const n = b.niveau || 'ALL';
        return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
      });
      
      setBooks(filtered);
      setLoading(false);
    }, (err) => {
      setError("Impossible de charger les livres.");
      console.error(err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userFiliere, userNiveau]);

  const handleSelectBook = (book: any) => {
    setSelectedBook(book);
    setLoading(true);
    setError(null);
    
    // We already have allChapters globally, so just filter it in memory
    // This is instantaneous and avoids adding more listeners (memory leaks)
    const filtered = allChapters.filter(c => c.bookId === book.id);
    setChapters(filtered);
    setLoading(false);
    setView('chapters');
  };

  const handleSelectChapter = async (chapter: any) => {
    setSelectedChapter(chapter);
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'blocks'), where('chapterId', '==', chapter.id), orderBy('importDate', 'desc'));
      const snapshot = await getDocs(q);
      const blocksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      
      // Global Filtering
      const filtered = blocksData.filter(b => {
        if (isAdmin) return true;
        const f = b.filiere || 'ECN';
        const n = b.niveau || 'ALL';
        return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
      });

      // If no blocks found, handle as legacy (direct questions) or create a default block
      if (filtered.length === 0) {
        // Fetch questions directly for legacy support
        const qQuery = query(collection(db, 'questions'), where('chapterId', '==', chapter.id), orderBy('number', 'asc'));
        const questionsSnap = await getDocs(qQuery);
        if (!questionsSnap.empty) {
          // Create a virtual default block
          setBlocks([{ id: 'default', blockTitle: 'Bloc par défaut', chapterId: chapter.id }]);
        } else {
          setBlocks([]);
        }
      } else {
        setBlocks(filtered);
      }
      
      setView('blocks');
    } catch (err) {
      setError("Impossible de charger les blocs.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartDailyPlan = async (plan: any) => {
    if (!plan || !plan.selectedBlocks || plan.selectedBlocks.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      let allQuestionsData: any[] = [];
      
      // Fetch questions for all selected blocks
      for (const blockId of plan.selectedBlocks) {
        let qQuery;
        if (blockId.startsWith('default-')) {
          const chapterId = blockId.replace('default-', '');
          qQuery = query(collection(db, 'questions'), where('chapterId', '==', chapterId), orderBy('number', 'asc'));
        } else {
          qQuery = query(collection(db, 'questions'), where('blockId', '==', blockId), orderBy('number', 'asc'));
        }
        const questionsSnap = await getDocs(qQuery);
        allQuestionsData = [...allQuestionsData, ...questionsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }))];
      }

      // Fetch Answers for ALL available questions first to see which ones have answers
      const questionIds = allQuestionsData.map(q => q.id);
      let allAnswers: any[] = [];
      
      if (questionIds.length > 0) {
        for (let i = 0; i < questionIds.length; i += 30) {
          const batchIds = questionIds.slice(i, i + 30);
          const aQuery = query(collection(db, 'answers'), where('questionId', 'in', batchIds));
          const answersSnap = await getDocs(aQuery);
          allAnswers = [...allAnswers, ...answersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))];
        }
      }

      // Filter out questions that do not have associated answers in the database
      let filteredQuestions = allQuestionsData.filter(q => allAnswers.some(a => a.questionId === q.id));

      if (filteredQuestions.length === 0 && allQuestionsData.length > 0) {
        console.warn("Aucune réponse correspondante trouvée, utilisation de toutes les questions.");
        filteredQuestions = allQuestionsData;
      }

      // Limit to daily target
      const dailyTarget = plan.questionsPerDay || 30;
      // Simple shuffle and slice on the valid questions
      filteredQuestions = filteredQuestions.sort(() => 0.5 - Math.random()).slice(0, dailyTarget);

      const combined = filteredQuestions.map(q => buildQuestionWithImages(q, allAnswers.find(a => a.questionId === q.id)));

      setQuestions(combined);
      setCurrentIdx(0);
      setUserAnswers({});
      setValidated({});
      setView('training');
    } catch (err: any) {
      setError("Erreur lors du chargement des questions du jour.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBlock = async (block: any) => {
    setSelectedBlock(block);
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Questions
      let qQuery;
      if (block.id === 'default') {
        qQuery = query(collection(db, 'questions'), where('chapterId', '==', block.chapterId), orderBy('number', 'asc'));
      } else {
        qQuery = query(collection(db, 'questions'), where('blockId', '==', block.id), orderBy('number', 'asc'));
      }
      
      const questionsSnap = await getDocs(qQuery);
      const questionsData = questionsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));

      // 2. Fetch Answers for these questions
      const questionIds = questionsData.map(q => q.id);
      let allAnswers: any[] = [];
      
      if (questionIds.length > 0) {
        for (let i = 0; i < questionIds.length; i += 30) {
          const batchIds = questionIds.slice(i, i + 30);
          const aQuery = query(collection(db, 'answers'), where('questionId', 'in', batchIds));
          const answersSnap = await getDocs(aQuery);
          allAnswers = [...allAnswers, ...answersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))];
        }
      }

      // 3. Combine and filter out questions without answers in the database
      let combined = questionsData
        .filter(q => allAnswers.some(a => a.questionId === q.id))
        .map(q => buildQuestionWithImages(q, allAnswers.find(a => a.questionId === q.id)));

      if (combined.length === 0 && questionsData.length > 0) {
        combined = questionsData.map(q => buildQuestionWithImages(q, allAnswers.find(a => a.questionId === q.id)));
      }

      setQuestions(combined);
      setCurrentIdx(0);
      setUserAnswers({});
      setValidated({});
      setView('training');
    } catch (err: any) {
      setError("Erreur lors du chargement des questions.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = (letter: string) => {
    if (view === 'training' && validated[currentIdx]) return;
    setUserAnswers({ ...userAnswers, [currentIdx]: letter });
  };

  const handleValidate = () => {
    if (!userAnswers[currentIdx]) return;
    setValidated({ ...validated, [currentIdx]: true });
    
    // Update progress
    const question = questions[currentIdx];
    const questionType = question?.type || 'QCM';
    let isCorrect = false;
    if (questionType === 'VRAI_FAUX') {
      isCorrect = normalizeVFAnswer(userAnswers[currentIdx]) === normalizeVFAnswer(question.answer?.correctLetter);
    } else {
      isCorrect = userAnswers[currentIdx] === question.answer?.correctLetter;
    }
    const xp = isCorrect ? 10 : 2;
    
    console.log("VALIDATE TRIGGERED", { 
      idx: currentIdx, 
      questionId: question?.id, 
      selected: userAnswers[currentIdx], 
      correct: question.answer?.correctLetter,
      isCorrect 
    });

    updateUserProgress(isCorrect, xp, question);
    handleErrorTracking(question, userAnswers[currentIdx], isCorrect);
  };

  // --- Planner Logic ---

  useEffect(() => {
    if (view === 'planning') {
      const fetchChaptersForBooks = async () => {
        if (plannerConfig.selectedBooks.length === 0) {
          setPlannerAvailableChapters([]);
          setPlannerConfig(prev => ({ ...prev, selectedChapters: [], selectedBlocks: [] }));
          return;
        }
        try {
          let allChaps: any[] = [];
          for (const bookId of plannerConfig.selectedBooks) {
            const cQuery = query(collection(db, 'chapters'), where('bookId', '==', bookId), orderBy('title', 'asc'));
            const snap = await getDocs(cQuery);
            const filtered = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
              .filter(c => {
                if (isAdmin) return true;
                const f = c.filiere || 'ECN';
                const n = c.niveau || 'ALL';
                return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
              });
            allChaps = [...allChaps, ...filtered];
          }
          setPlannerAvailableChapters(allChaps);
          
          const validChapterIds = allChaps.map(c => c.id);
          setPlannerConfig(prev => ({
            ...prev,
            selectedChapters: prev.selectedChapters.filter(id => validChapterIds.includes(id))
          }));
        } catch (e) {
          console.error("Error fetching chapters", e);
        }
      };
      fetchChaptersForBooks();
    }
  }, [plannerConfig.selectedBooks, view]);

  useEffect(() => {
    if (view === 'planning') {
      const fetchBlocksForChapters = async () => {
        if (plannerConfig.selectedChapters.length === 0) {
          setPlannerAvailableBlocks([]);
          return;
        }
        try {
          let allBlocks: any[] = [];
          for (const chapterId of plannerConfig.selectedChapters) {
            const bQuery = query(collection(db, 'blocks'), where('chapterId', '==', chapterId), orderBy('importDate', 'desc'));
            const snap = await getDocs(bQuery);
            const filtered = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
              .filter(b => {
                if (isAdmin) return true;
                const f = b.filiere || 'ECN';
                const n = b.niveau || 'ALL';
                return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
              });
            allBlocks = [...allBlocks, ...filtered];
          }
          setPlannerAvailableBlocks(allBlocks);
        } catch (e) {
          console.error("Error fetching blocks", e);
        }
      };
      fetchBlocksForChapters();
    }
  }, [plannerConfig.selectedChapters, view]);

  useEffect(() => {
    if (view === 'planning') {
      const fetchQuestionCount = async () => {
        if (plannerConfig.selectedBlocks.length === 0) {
          setPlannerAvailableQuestionsCount(0);
          return;
        }
        try {
          let count = 0;
          for (const blockId of plannerConfig.selectedBlocks) {
            const qQuery = query(collection(db, 'questions'), where('blockId', '==', blockId));
            const snap = await getDocs(qQuery);
            count += snap.size;
          }
          setPlannerAvailableQuestionsCount(count);
        } catch (e) {
          console.error("Error fetching question count", e);
        }
      };
      fetchQuestionCount();
    }
  }, [plannerConfig.selectedBlocks, view]);

  // --- Simulation Logic ---

  useEffect(() => {
    if (view === 'simulation_config') {
      const fetchChaptersForBooks = async () => {
        if (simulationConfig.selectedBooks.length === 0) {
          setSimAvailableChapters([]);
          setSimulationConfig(prev => ({ ...prev, selectedChapters: [], selectedBlocks: [] }));
          return;
        }
        try {
          let allChaps: any[] = [];
          for (const bookId of simulationConfig.selectedBooks) {
            const cQuery = query(collection(db, 'chapters'), where('bookId', '==', bookId), orderBy('title', 'asc'));
            const snap = await getDocs(cQuery);
            const filtered = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
              .filter(c => {
                if (isAdmin) return true;
                const f = c.filiere || 'ECN';
                const n = c.niveau || 'ALL';
                return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
              });
            allChaps = [...allChaps, ...filtered];
          }
          setSimAvailableChapters(allChaps);
          
          const validChapterIds = allChaps.map(c => c.id);
          setSimulationConfig(prev => ({
            ...prev,
            selectedChapters: prev.selectedChapters.filter(id => validChapterIds.includes(id))
          }));
        } catch (e) {
          console.error("Error fetching chapters for simulation", e);
        }
      };
      fetchChaptersForBooks();
    }
  }, [simulationConfig.selectedBooks, view]);

  useEffect(() => {
    if (view === 'simulation_config') {
      const fetchBlocksForChapters = async () => {
        if (simulationConfig.selectedChapters.length === 0) {
          setSimAvailableBlocks([]);
          return;
        }
        try {
          let allBlocks: any[] = [];
          for (const chapterId of simulationConfig.selectedChapters) {
            const bQuery = query(collection(db, 'blocks'), where('chapterId', '==', chapterId), orderBy('importDate', 'desc'));
            const snap = await getDocs(bQuery);
            const filtered = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
              .filter(b => {
                if (isAdmin) return true;
                const f = b.filiere || 'ECN';
                const n = b.niveau || 'ALL';
                return (userFiliere === 'ALL' || f === userFiliere || f === 'ALL') && (userNiveau === 'ALL' || n === userNiveau || n === 'ALL');
              });
            allBlocks = [...allBlocks, ...filtered];
          }
          setSimAvailableBlocks(allBlocks);
        } catch (e) {
          console.error("Error fetching blocks for simulation", e);
        }
      };
      fetchBlocksForChapters();
    }
  }, [simulationConfig.selectedChapters, view]);

  useEffect(() => {
    if (view === 'simulation_config') {
      const fetchQuestionCount = async () => {
        if (simulationConfig.selectedBlocks.length === 0) {
          setSimAvailableQuestionsCount(0);
          return;
        }
        try {
          let count = 0;
          for (const blockId of simulationConfig.selectedBlocks) {
            const qQuery = query(collection(db, 'questions'), where('blockId', '==', blockId));
            const snap = await getDocs(qQuery);
            count += snap.size;
          }
          setSimAvailableQuestionsCount(count);
        } catch (e) {
          console.error("Error fetching question count for simulation", e);
        }
      };
      fetchQuestionCount();
    }
  }, [simulationConfig.selectedBlocks, view]);

  const handleStartSimulation = async () => {
    if (simulationConfig.selectedBlocks.length === 0) return;
    
    try {
      setLoading(true);
      setError(null);
      
      let allQuestionsData: any[] = [];
      const chunkSize = 30;
      
      for (let i = 0; i < simulationConfig.selectedBlocks.length; i += chunkSize) {
        const chunk = simulationConfig.selectedBlocks.slice(i, i + chunkSize);
        const q = query(collection(db, 'questions'), where('blockId', 'in', chunk));
        const snap = await getDocs(q);
        snap.docs.forEach(d => allQuestionsData.push({ id: d.id, ...d.data() }));
      }
      
      if (allQuestionsData.length === 0) {
        setError("Aucune question trouvée pour cette sélection.");
        return;
      }

      // Shuffle and limit if needed, or just take all
      if (simulationConfig.drawMode === 'random') {
        allQuestionsData = allQuestionsData.sort(() => 0.5 - Math.random());
      } else {
        allQuestionsData = allQuestionsData.sort((a, b) => (a.number || 0) - (b.number || 0));
      }

      if (isDemo) {
        allQuestionsData = allQuestionsData.slice(0, DEMO_LIMITS.MAX_QUESTIONS);
      }

      // Create a virtual exam
      const virtualExam = {
        id: 'simulation-' + Date.now(),
        title: 'Auto-évaluation',
        durationMinutes: simulationConfig.durationMinutes,
        questionIds: allQuestionsData.map(q => q.id),
        isSimulation: true
      };

      setSelectedExam(virtualExam);
      setSelectedExamAttempt(null);
      setExamSourceView('simulation_config');
      setView('exam_session');
    } catch (e) {
      console.error("Error starting simulation", e);
      setError("Erreur lors du lancement de la simulation.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (lastFinishedExam) {
      const fetchLeaderboard = async () => {
        try {
          const snap = await getDocs(query(collection(db, 'examAttempts'), where('examId', '==', lastFinishedExam.id), orderBy('score', 'desc')));
          const leaderboard = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setLastExamLeaderboard(leaderboard);
          
          if (userId) {
            const rank = leaderboard.findIndex((entry: any) => entry.userId === userId) + 1;
            setUserLastExamRank(rank > 0 ? rank : null);
          }
        } catch (err) {
          console.error("Error fetching leaderboard for last exam", err);
        }
      };
      fetchLeaderboard();
    }
  }, [lastFinishedExam, userId]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentQuestion = questions[currentIdx];

  const renderSimulationModeSelection = () => {
    const simulationModes = [
      {
        id: 'scheduled',
        title: 'Examens Officiels',
        description: 'Participez aux examens programmés par l\'administration.',
        icon: <Calendar className="w-8 h-8 text-indigo-600" />,
        color: 'bg-indigo-50',
        borderColor: 'border-indigo-100',
        onClick: () => setView('exams')
      },
      {
        id: 'freemode',
        title: 'Auto-évaluation',
        description: 'Générez un sujet sur mesure pour vous entraîner.',
        icon: <Target className="w-8 h-8 text-amber-600" />,
        color: 'bg-amber-50',
        borderColor: 'border-amber-100',
        onClick: () => setView('simulation_config')
      }
    ];

    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setView('dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour au Dashboard
          </button>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>

        <header className="text-center space-y-2">
          <h2 className="text-4xl font-display font-black text-gray-900 tracking-tight">Espace Simulation</h2>
          <p className="text-gray-500 font-medium">Choisissez le format d'évaluation qui vous convient.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          {simulationModes.map((mode) => (
            <motion.button
              key={mode.id}
              whileHover={{ y: -4 }}
              onClick={mode.onClick}
              className={cn(
                "p-8 rounded-3xl border-2 text-left transition-all group relative overflow-hidden",
                mode.color,
                mode.borderColor,
                "shadow-sm hover:shadow-xl"
              )}
            >
              <div className="relative z-10 space-y-4">
                <div className="bg-white p-4 rounded-2xl w-fit shadow-sm group-hover:scale-110 transition-transform">
                  {mode.icon}
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900 mb-2">{mode.title}</h3>
                  <p className="text-gray-600 font-medium leading-relaxed">{mode.description}</p>
                </div>
              </div>
              <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                <ArrowRight className="w-24 h-24 -rotate-45" />
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    );
  };

  const renderRevision = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour
            </button>
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>

        <header className="space-y-4 text-center py-8">
          <h2 className="text-4xl font-display font-black text-gray-900 tracking-tight">Espace Révision</h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">Renforcez vos connaissances avec nos fiches de synthèse et vidéos de cours.</p>
        </header>

        {/* Mode selection */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { id: 'fiches', title: 'Fiches de cours', icon: <BookOpen className="w-8 h-8" />, color: 'bg-emerald-50 text-emerald-600', description: 'Fiches illustrées.' },
            { id: 'mindmap', title: 'Carte Mentale', icon: <GitBranch className="w-8 h-8" />, color: 'bg-indigo-50 text-indigo-600', description: 'Arborescence interactive.' },
            { id: 'videos', title: 'Vidéos de cours', icon: <MonitorPlay className="w-8 h-8" />, color: 'bg-blue-50 text-blue-600', description: 'Apprentissage vidéo.' },
            { id: 'mix', title: 'Mode Mixte', icon: <Sparkles className="w-8 h-8" />, color: 'bg-purple-50 text-purple-600', description: 'Fiche → Vidéo → QCM.' }
          ].map(mode => (
            <motion.button
              key={mode.id}
              whileHover={{ y: -5, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setRevisionMode(mode.id as any)}
              className={cn(
                "p-6 rounded-[2.5rem] border-2 transition-all text-left space-y-4 relative overflow-hidden",
                revisionMode === mode.id ? "border-indigo-500 bg-white ring-4 ring-indigo-50 shadow-xl" : "border-gray-100 bg-white hover:border-indigo-200 shadow-sm"
              )}
            >
              <div className={cn("p-4 rounded-2xl w-fit", mode.color)}>
                {mode.icon}
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">{mode.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed mt-1">{mode.description}</p>
              </div>
              {revisionMode === mode.id && <div className="absolute top-4 right-4"><CheckCircle2 className="w-6 h-6 text-indigo-600" /></div>}
            </motion.button>
          ))}
        </div>

        {/* Selection Area */}
        <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8">
          <div className="flex items-center gap-4 border-b pb-4">
            <Settings className="w-6 h-6 text-gray-400" />
            <h3 className="text-xl font-bold text-gray-900">Personnaliser votre révision</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Books */}
              <div className="space-y-4">
              <h4 className="font-bold text-gray-900 flex items-center gap-2">
                <Book className="w-5 h-5 text-indigo-500" /> Livres
              </h4>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {userFiliere === 'ECN' ? (
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-indigo-100 bg-indigo-50/30 hover:bg-indigo-50 cursor-pointer transition-colors shadow-sm">
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={revisionSelection.books.includes('serie_q_virtual')}
                      onChange={(e) => {
                        const newBooks = e.target.checked ? ['serie_q_virtual'] : [];
                        setRevisionSelection(prev => ({ ...prev, books: newBooks, chapters: [], blocks: [] }));
                      }}
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-indigo-700">Série Q</span>
                      <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">Contenu exclusif Révision</span>
                    </div>
                  </label>
                ) : (
                  books.map((book, idx) => {
                    const accessible = isBookAccessible(book);
                    return (
                      <label key={book.id} className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border border-gray-100 transition-colors",
                        accessible ? "hover:bg-gray-50 cursor-pointer" : "opacity-50 cursor-not-allowed bg-gray-50/50"
                      )}>
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          checked={revisionSelection.books.includes(book.id)}
                          disabled={!accessible}
                          onChange={(e) => {
                            const newBooks = e.target.checked 
                              ? [...revisionSelection.books, book.id]
                              : revisionSelection.books.filter(id => id !== book.id);
                            setRevisionSelection(prev => ({ ...prev, books: newBooks, chapters: [], blocks: [] }));
                          }}
                        />
                        <div className="flex items-center justify-between flex-1">
                          <span className="text-sm font-semibold text-gray-700">{book.name}</span>
                          {!accessible && <Lock className="w-3 h-3 text-gray-400" />}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Chapters */}
            <div className="space-y-4">
              <h4 className="font-bold text-gray-900 flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-emerald-500" /> Chapitres
              </h4>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {userFiliere === 'ECN' && revisionSelection.books.includes('serie_q_virtual') ? (
                  <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100 italic text-gray-400 font-medium">
                    <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    Sélection directe via "Série Q"
                  </div>
                ) : revisionSelection.books.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sélectionnez un livre d'abord.</p>
                ) : (
                  chapters
                    .filter(c => revisionSelection.books.includes(c.bookId))
                    .map((chap, idx) => {
                      const accessible = isChapterAccessible(chap, idx);
                      return (
                        <label key={chap.id} className={cn(
                          "flex items-center gap-3 p-3 rounded-xl border border-gray-100 transition-colors",
                          accessible ? "hover:bg-gray-50 cursor-pointer" : "opacity-50 cursor-not-allowed bg-gray-50/50"
                        )}>
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            checked={revisionSelection.chapters.includes(chap.id)}
                            disabled={!accessible}
                            onChange={(e) => {
                              const newChaps = e.target.checked 
                                ? [...revisionSelection.chapters, chap.id]
                                : revisionSelection.chapters.filter(id => id !== chap.id);
                              setRevisionSelection(prev => ({ ...prev, chapters: newChaps, blocks: [] }));
                            }}
                          />
                          <div className="flex items-center justify-between flex-1 truncate">
                            <span className="text-sm font-semibold text-gray-700 truncate">{chap.title}</span>
                            {!accessible && <Lock className="w-3 h-3 text-gray-400 shrink-0" />}
                          </div>
                        </label>
                      );
                    })
                )}
              </div>
            </div>

            {/* Blocks */}
            <div className="space-y-4">
              <h4 className="font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-500" /> {userFiliere === 'ECN' ? 'Items' : 'Blocs'}
              </h4>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {userFiliere === 'ECN' && revisionSelection.books.includes('serie_q_virtual') ? (
                   seriesQ.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Aucune série disponible.</p>
                   ) : (
                    seriesQ
                      .filter(s => s.filiere === userFiliere || s.filiere === 'ALL')
                      .map((s, idx) => {
                        const accessible = isDemo ? idx === 0 : true;
                        return (
                          <div 
                            key={s.id} 
                            className={cn(
                              "p-3 rounded-xl border border-gray-100 bg-white shadow-sm flex items-center justify-between group transition-all",
                              accessible ? "hover:border-indigo-200 cursor-pointer" : "opacity-50 cursor-not-allowed"
                            )}
                          >
                             <div className="flex flex-col">
                               <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-700">{s.title}</span>
                                {!accessible && <Lock className="w-3 h-3 text-gray-400" />}
                               </div>
                               <div className="flex gap-2 mt-1">
                                 <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold uppercase">Vidéo</span>
                                 <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-bold uppercase">Fiche</span>
                               </div>
                             </div>
                             {accessible ? (
                               <Play className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 transition-colors" />
                             ) : (
                               <Crown className="w-4 h-4 text-amber-400" />
                             )}
                          </div>
                        );
                      })
                   )
                ) : revisionSelection.chapters.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sélectionnez un chapitre d'abord.</p>
                ) : (
                  blocks
                    .filter(b => revisionSelection.chapters.includes(b.chapterId))
                    .map((block, idx) => {
                      const accessible = isBlockAccessible(block, idx);
                      return (
                        <label key={block.id} className={cn(
                          "flex items-center gap-3 p-3 rounded-xl border border-gray-100 transition-colors",
                          accessible ? "hover:bg-gray-50 cursor-pointer" : "opacity-50 cursor-not-allowed bg-gray-50/50"
                        )}>
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                            checked={revisionSelection.blocks.includes(block.id)}
                            disabled={!accessible}
                            onChange={(e) => {
                              const newBlocks = e.target.checked 
                                ? [...revisionSelection.blocks, block.id]
                                : revisionSelection.blocks.filter(id => id !== block.id);
                              setRevisionSelection(prev => ({ ...prev, blocks: newBlocks }));
                            }}
                          />
                          <div className="flex items-center justify-between flex-1 truncate">
                            <span className="text-sm font-semibold text-gray-700 truncate">{block.title}</span>
                            {!accessible && <Lock className="w-3 h-3 text-gray-400 shrink-0" />}
                          </div>
                        </label>
                      );
                    })
                )}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500 font-medium italic">Note: Le mode révision affiche uniquement les questions contenant des supports pédagogiques (fiches ou vidéos).</p>
            <button
              onClick={() => handleStartRevision(revisionMode)}
              disabled={loading || revisionSelection.books.length === 0}
              className="w-full md:w-auto px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              Lancer la révision
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderRevisionSession = () => {
    const currentItem = revisionItems[revisionIdx];
    if (!currentItem) return null;

    const nextItem = () => {
      if (revisionIdx < revisionItems.length - 1) {
        setRevisionIdx(idx => idx + 1);
      } else {
        setView('revision');
      }
    };

    const prevItem = () => {
      if (revisionIdx > 0) {
        setRevisionIdx(idx => idx - 1);
      }
    };

    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 flex flex-col h-screen max-h-screen overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setView('revision')} 
              className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group py-2"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Quitter
            </button>
            <div className="px-4 py-1 bg-indigo-100 text-indigo-600 rounded-full text-xs font-black uppercase tracking-widest border border-indigo-200">
              Contenu {revisionIdx + 1} / {revisionItems.length}
            </div>
          </div>
          <div className="text-gray-400 text-sm font-bold flex items-center gap-2">
            {revisionMode === 'mix' && <Sparkles className="w-4 h-4" />}
            {revisionMode === 'fiches' && <BookOpen className="w-4 h-4" />}
            {revisionMode === 'videos' && <MonitorPlay className="w-4 h-4" />}
            <span className="hidden sm:inline">Module Révision : {revisionMode.toUpperCase()}</span>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-xl overflow-hidden flex flex-col relative">
          <div className="h-1.5 bg-gray-100 w-full shrink-0">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${((revisionIdx + 1) / revisionItems.length) * 100}%` }}
              className="h-full bg-indigo-600"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-10 relative custom-scrollbar flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={revisionIdx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full max-w-4xl h-full flex flex-col"
              >
                {currentItem.type === 'fiche' && (
                  <div className="flex flex-col h-full space-y-4 w-full">
                    <h3 className="text-center text-lg font-bold text-gray-800">Fiche de synthèse</h3>
                    <div className="flex-1 relative bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 flex items-center justify-center group">
                      <img 
                        src={currentItem.url} 
                        alt="Fiche de révision" 
                        className="max-w-full max-h-[70vh] object-contain cursor-zoom-in group-hover:scale-[1.01] transition-transform duration-500"
                        onLoad={() => recordViewedMaterial('fiche')}
                        onClick={() => setEnlargedImage(currentItem.url)}
                        referrerPolicy="no-referrer"
                      />
                      <button 
                        onClick={() => setEnlargedImage(currentItem.url)}
                        className="absolute bottom-6 right-6 bg-white/90 backdrop-blur-sm p-4 rounded-full shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Maximize2 className="w-6 h-6 text-indigo-600" />
                      </button>
                    </div>
                  </div>
                )}

                {currentItem.type === 'pdf' && (
                  <div className="flex flex-col h-full space-y-4 w-full">
                    <h3 className="text-center text-lg font-bold text-gray-800">Support PDF : {currentItem.blockTitle || "Document"}</h3>
                    <div className="flex-1 bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                      <iframe 
                        src={`${currentItem.url}#view=FitH`} 
                        className="w-full h-full border-none"
                        title="PDF Viewer"
                        onLoad={() => recordViewedMaterial('fiche')}
                      />
                    </div>
                    <div className="flex justify-center">
                      <a 
                        href={currentItem.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm border border-indigo-100 hover:bg-indigo-100 transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Ouvrir en plein écran
                      </a>
                    </div>
                  </div>
                )}

                {currentItem.type === 'video' && (
                  <div className="flex flex-col h-full space-y-4">
                    <h4 className="text-lg font-bold text-gray-800 text-center">Vidéo explicative</h4>
                    <div className="flex-1 bg-black rounded-2xl overflow-hidden shadow-2xl relative group border-4 border-gray-900 aspect-video max-h-[70vh] w-full mx-auto">
                      {currentItem.url?.includes('youtube.com') || currentItem.url?.includes('youtu.be') || currentItem.url?.includes('vimeo.com') ? (
                        <iframe
                          src={getEmbedUrl(currentItem.url)}
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          onLoad={() => recordViewedMaterial('video')}
                        />
                      ) : (
                        <video 
                          src={currentItem.url} 
                          controls 
                          className="w-full h-full object-contain"
                          onPlay={() => recordViewedMaterial('video')}
                        />
                      )}
                    </div>
                  </div>
                )}

                {currentItem.type === 'mindmap' && (
                  <div className="flex flex-col h-full space-y-4">
                    <h3 className="text-center text-lg font-bold text-gray-800">Carte Mentale Interactive</h3>
                    <MindMapCard tree={currentItem.tree} />
                  </div>
                )}

                {currentItem.type === 'qcm' && (
                  <div className="space-y-8 py-4">
                    <div className="text-center space-y-2">
                      <span className="px-3 py-1 bg-purple-100 text-purple-600 rounded-full text-[10px] font-black uppercase tracking-tighter">Mini-Test de validation</span>
                      {(currentItem.question.sharedStem || currentItem.question.groupTitle) && (
                        <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl mb-4 text-left max-w-2xl mx-auto shadow-sm">
                          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1 flex items-center gap-1">
                            <Info className="w-3 h-3" /> {currentItem.question.groupTitle || 'Énoncé Commun'}
                          </p>
                          {currentItem.question.sharedStem && (
                            <p className="text-sm text-gray-800 font-medium italic leading-relaxed">
                              {currentItem.question.sharedStem}
                            </p>
                          )}
                        </div>
                      )}
                      <h3 className="text-xl font-display font-bold text-gray-900 leading-tight">
                        {currentItem.question.text}
                      </h3>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4 max-w-2xl mx-auto">
                      {currentItem.question.options?.map((opt: any, idx: number) => (
                        <button
                          key={idx}
                          className="flex items-center gap-4 p-5 rounded-2xl border-2 border-gray-100 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left bg-white group shadow-sm"
                          onClick={() => {
                            // Instant feedback for mini QCM
                            if (opt.letter === currentItem.question.answer?.correctLetter) {
                              alert("Correct !");
                            } else {
                              alert("Désolé, c'est incorrect.");
                            }
                          }}
                        >
                           <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center font-bold text-gray-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                            {opt.letter}
                           </div>
                           <span className="font-semibold text-gray-700">{opt.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Context Footer Controls */}
          <div className="p-4 bg-gray-50/80 backdrop-blur-sm border-t border-gray-100 shrink-0 flex items-center justify-between px-8">
            <button
               onClick={prevItem}
               disabled={revisionIdx === 0}
               className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-white hover:shadow-sm transition-all disabled:opacity-30"
            >
              <ArrowLeft className="w-5 h-5" /> Précédent
            </button>
            
            <div className="hidden md:flex flex-col items-center">
               <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Ma Progression</span>
               <div className="flex gap-1.5">
                  {revisionItems.map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "w-2.5 h-1.5 rounded-full transition-all duration-300",
                        i === revisionIdx ? "w-6 bg-indigo-600" : (i < revisionIdx ? "bg-indigo-300" : "bg-gray-200")
                      )} 
                    />
                  ))}
               </div>
            </div>

            <button
               onClick={nextItem}
               className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all group"
            >
              {revisionIdx === revisionItems.length - 1 ? "Terminer" : "Suivant"}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSimulationConfig = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative">
        <button 
          onClick={() => setView('simulation')} 
          className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1 relative z-10 cursor-pointer touch-action-manipulation"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour à Simulation
        </button>

        <header className="bg-white p-8 rounded-3xl border border-indigo-100 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-bl-full -z-10 opacity-50" />
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 bg-indigo-50 rounded-2xl">
              <Book className="w-8 h-8 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Configuration de l'Auto-évaluation</h2>
              <p className="text-gray-500 font-medium">Sélectionnez les questions et définissez la durée.</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8">
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 border-b pb-2">Paramètres</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Durée (minutes)</label>
                    <input 
                      type="number" 
                      min="1"
                      max="240"
                      className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={simulationConfig.durationMinutes}
                      onChange={(e) => setSimulationConfig(prev => ({ ...prev, durationMinutes: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Mode de tirage</label>
                    <select 
                      className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      value={simulationConfig.drawMode}
                      onChange={(e) => setSimulationConfig(prev => ({ ...prev, drawMode: e.target.value as any }))}
                    >
                      <option value="random">Aléatoire</option>
                      <option value="sequential">Séquentiel</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Books Selection */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 border-b pb-2">1. Livres à inclure</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
                  {books.map(book => {
                    const accessible = isBookAccessible(book);
                    if (!accessible && isDemo) return null;
                    return (
                      <label key={book.id} className={cn(
                        "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                        simulationConfig.selectedBooks.includes(book.id) ? "border-indigo-600 bg-indigo-50/50" : "border-gray-200 hover:border-indigo-300"
                      )}>
                        <input 
                          type="checkbox" 
                          className="mt-1 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                          checked={simulationConfig.selectedBooks.includes(book.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSimulationConfig(prev => ({ ...prev, selectedBooks: [...prev.selectedBooks, book.id] }));
                            } else {
                              setSimulationConfig(prev => ({ ...prev, selectedBooks: prev.selectedBooks.filter(id => id !== book.id) }));
                            }
                          }}
                        />
                        <div>
                          <p className="font-bold text-gray-900">{book.name}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {books.length > 0 && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setSimulationConfig(prev => ({ ...prev, selectedBooks: books.map(b => b.id) }))}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Tout sélectionner
                    </button>
                    <button 
                      onClick={() => setSimulationConfig(prev => ({ ...prev, selectedBooks: [] }))}
                      className="text-xs font-bold text-gray-600 hover:text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Tout désélectionner
                    </button>
                  </div>
                )}
              </div>

              {/* Chapters Selection */}
              {simulationConfig.selectedBooks.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 border-b pb-2">2. Sections à inclure</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
                    {simAvailableChapters.map((chapter, index) => {
                      const accessible = isChapterAccessible(chapter, index);
                      if (!accessible && isDemo) return null;
                      const bookName = books.find(b => b.id === chapter.bookId)?.name || '';
                      return (
                        <label key={chapter.id} className={cn(
                          "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                          simulationConfig.selectedChapters.includes(chapter.id) ? "border-indigo-600 bg-indigo-50/50" : "border-gray-200 hover:border-indigo-300"
                        )}>
                          <input 
                            type="checkbox" 
                            className="mt-1 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                            checked={simulationConfig.selectedChapters.includes(chapter.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSimulationConfig(prev => ({ ...prev, selectedChapters: [...prev.selectedChapters, chapter.id] }));
                              } else {
                                setSimulationConfig(prev => ({ ...prev, selectedChapters: prev.selectedChapters.filter(id => id !== chapter.id) }));
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 text-sm truncate">{chapter.title}</p>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{bookName}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {simAvailableChapters.length > 0 && (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setSimulationConfig(prev => ({ ...prev, selectedChapters: simAvailableChapters.map(c => c.id) }))}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Tout sélectionner
                      </button>
                      <button 
                        onClick={() => setSimulationConfig(prev => ({ ...prev, selectedChapters: [] }))}
                        className="text-xs font-bold text-gray-600 hover:text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Tout désélectionner
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Blocks Selection */}
              {simulationConfig.selectedChapters.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 border-b pb-2">3. Blocs à inclure</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
                    {simAvailableBlocks.map(block => {
                      const chapterTitle = simAvailableChapters.find(c => c.id === block.chapterId)?.title || '';
                      return (
                        <label key={block.id} className={cn(
                          "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                          simulationConfig.selectedBlocks.includes(block.id) ? "border-indigo-600 bg-indigo-50/50" : "border-gray-200 hover:border-indigo-300"
                        )}>
                          <input 
                            type="checkbox" 
                            className="mt-1 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                            checked={simulationConfig.selectedBlocks.includes(block.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSimulationConfig(prev => ({ ...prev, selectedBlocks: [...prev.selectedBlocks, block.id] }));
                              } else {
                                setSimulationConfig(prev => ({ ...prev, selectedBlocks: prev.selectedBlocks.filter(id => id !== block.id) }));
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 text-sm truncate">{block.blockTitle || "Bloc sans nom"}</p>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{chapterTitle}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {simAvailableBlocks.length > 0 && (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setSimulationConfig(prev => ({ ...prev, selectedBlocks: simAvailableBlocks.map(b => b.id) }))}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Tout sélectionner
                      </button>
                      <button 
                        onClick={() => setSimulationConfig(prev => ({ ...prev, selectedBlocks: [] }))}
                        className="text-xs font-bold text-gray-600 hover:text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Tout désélectionner
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4">
                <button
                  type="button"
                  className={`w-full font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 ${
                    loading || simulationConfig.selectedBlocks.length === 0
                      ? 'bg-gray-300 text-white cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 cursor-pointer'
                  }`}
                  disabled={loading || simulationConfig.selectedBlocks.length === 0}
                  onClick={handleStartSimulation}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                  Lancer l'auto-évaluation
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
              <h3 className="text-lg font-bold text-gray-900">Résumé</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                  <span className="text-gray-500 font-medium">Questions totales</span>
                  <span className="font-bold text-gray-900">{simAvailableQuestionsCount}</span>
                </div>
                <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                  <span className="text-gray-500 font-medium">Durée</span>
                  <span className="font-bold text-gray-900">{simulationConfig.durationMinutes} min</span>
                </div>
                <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                  <span className="text-gray-500 font-medium">Blocs sélectionnés</span>
                  <span className="font-bold text-gray-900">{simulationConfig.selectedBlocks.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBooks = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour au Dashboard
            </button>
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>
        <header className="text-center space-y-6 mt-4 md:mt-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-50 rounded-2xl mb-2">
            <Book className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-gray-900 tracking-tight">
            Auto-<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">évaluation</span>
          </h1>
          <p className="text-gray-500 text-lg max-w-2xl mx-auto">
            Sélectionnez un ouvrage pour commencer votre entraînement.
          </p>
        </header>

        {error && (
          <div className="bg-red-50/50 backdrop-blur-sm border border-red-200 text-red-700 p-4 rounded-2xl flex items-center gap-3 max-w-2xl mx-auto">
            <XCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
            <button onClick={fetchBooks} className="ml-auto text-xs bg-white hover:bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg transition-colors font-medium shadow-sm">Réessayer</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {books.map((book) => {
            const accessible = isBookAccessible(book);
            return (
              <motion.button
                whileHover={accessible ? { y: -4, scale: 1.01 } : {}}
                whileTap={accessible ? { scale: 0.98 } : {}}
                key={book.id}
                onClick={() => {
                  if (accessible) {
                    handleSelectBook(book);
                  } else {
                    askConfirmation(
                      "Contenu Bloqué",
                      "🔒 Débloque l'application pour accéder à tout le contenu. Voulez-vous contacter un administrateur ?",
                      () => window.open("https://wa.me/237698946202", "_blank")
                    );
                  }
                }}
                className={cn(
                  "bg-white p-6 rounded-3xl border border-gray-200/60 shadow-sm transition-all text-left flex flex-col gap-6 group relative overflow-hidden",
                  accessible ? "hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-200" : "opacity-75 grayscale-[0.5]"
                )}
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-bl-full -z-10 opacity-50 group-hover:opacity-100 transition-opacity" />
                
                <div className="flex items-start justify-between">
                  <div className="bg-white shadow-sm border border-gray-100 p-3 rounded-2xl group-hover:scale-110 transition-transform duration-300">
                    {accessible ? <Book className="w-6 h-6 text-blue-600" /> : <Lock className="w-6 h-6 text-gray-400" />}
                  </div>
                  {!accessible && (
                    <div className="bg-gray-100 text-gray-500 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      Premium
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-xl font-display font-bold text-gray-900 leading-tight group-hover:text-blue-600 transition-colors">{book.name}</h3>
                  <p className="text-sm text-gray-500 font-medium flex items-center gap-1">
                    {accessible ? (
                      <>Ouvrir la collection <ChevronRight className="w-4 h-4" /></>
                    ) : (
                      <>Contenu verrouillé <Lock className="w-3 h-3" /></>
                    )}
                  </p>
                </div>
              </motion.button>
            );
          })}
          {books.length === 0 && !loading && (
            <div className="col-span-full py-24 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-3xl bg-white/50 backdrop-blur-sm">
              <LayoutGrid className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">Aucun livre disponible. Utilisez l'interface admin pour en ajouter.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderDemoEnd = () => {
    const score = userProgress ? Math.round(userProgress.accuracy * 100) : 0;
    const motivation = score >= 80 ? "🔥 Impressionnant !" : score >= 50 ? "👍 Pas mal !" : "💪 Tu peux faire mieux !";

    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8 text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Target className="w-12 h-12 text-blue-600" />
        </div>
        <div className="space-y-4">
          <h2 className="text-4xl font-black text-gray-900">🎯 Fin de la démo</h2>
          <p className="text-xl text-gray-500 font-medium">
            Tu as atteint la limite de {DEMO_LIMITS.MAX_QUESTIONS} questions gratuites.
          </p>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-gray-100 max-w-md mx-auto space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Ton Score</p>
            <div className="text-6xl font-black text-blue-600">{score}%</div>
            <p className="text-lg font-bold text-gray-700">{motivation}</p>
          </div>
          
          <div className="pt-4 space-y-4">
            <p className="text-gray-600 font-medium">🎯 Tu veux continuer à t’entraîner ? Passe à la version complète pour débloquer tous les livres et chapitres.</p>
            <button 
              onClick={() => onLogout?.()}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2 text-lg"
            >
              <Crown className="w-6 h-6" />
              Débloquer maintenant
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderChapters = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('books')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour aux livres
            </button>
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>

        <header className="space-y-2 bg-white p-6 md:p-8 rounded-3xl border border-gray-200/60 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-bl-full -z-10 opacity-50" />
          <div className="inline-flex items-center justify-center p-2 bg-blue-50 rounded-xl mb-2">
            <Book className="w-6 h-6 text-blue-600" />
          </div>
          <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">{selectedBook?.name}</h2>
          <p className="text-gray-500 font-medium">Sélectionnez un chapitre pour vous entraîner</p>
        </header>

        <div className="grid grid-cols-1 gap-4">
          {chapters.map((chapter, index) => {
            const accessible = isChapterAccessible(chapter, index);
            return (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={accessible ? { scale: 1.01, x: 4 } : {}}
                whileTap={accessible ? { scale: 0.99 } : {}}
                key={chapter.id}
                onClick={() => {
                  if (accessible) {
                    handleSelectChapter(chapter);
                  } else {
                    askConfirmation(
                      "Contenu Bloqué",
                      "🔒 Débloque l'application pour accéder à tout le contenu. Voulez-vous contacter un administrateur ?",
                      () => window.open("https://wa.me/237698946202", "_blank")
                    );
                  }
                }}
                className={cn(
                  "bg-white p-5 rounded-2xl border border-gray-200/60 transition-all text-left flex items-center gap-5 group",
                  accessible ? "hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/5" : "opacity-75"
                )}
              >
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center font-bold transition-colors border",
                  accessible ? "bg-gray-50 text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600 border-gray-100" : "bg-gray-100 text-gray-300 border-gray-200"
                )}>
                  {accessible ? <span className="font-display">{index + 1}</span> : <Lock className="w-5 h-5" />}
                </div>
                <span className={cn(
                  "text-lg font-semibold transition-colors",
                  accessible ? "text-gray-800 group-hover:text-blue-700" : "text-gray-400"
                )}>{chapter.title}</span>
                {accessible ? (
                  <ChevronRight className="w-5 h-5 ml-auto text-gray-300 group-hover:text-blue-500 transition-colors" />
                ) : (
                  <div className="ml-auto bg-gray-100 text-gray-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                    Premium
                  </div>
                )}
              </motion.button>
            );
          })}
          {chapters.length === 0 && !loading && (
            <div className="text-center text-gray-400 py-16 bg-white rounded-3xl border border-gray-200/60 border-dashed">
              <Book className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Aucun chapitre trouvé pour ce livre.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderBlocks = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('chapters')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour aux chapitres
            </button>
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>

        <header className="space-y-2 bg-white p-6 md:p-8 rounded-3xl border border-gray-200/60 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-bl-full -z-10 opacity-50" />
          <div className="inline-flex items-center justify-center p-2 bg-indigo-50 rounded-xl mb-2">
            <Layers className="w-6 h-6 text-indigo-600" />
          </div>
          <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">{selectedChapter?.title}</h2>
          <p className="text-gray-500 font-medium">Choisissez un bloc de questions pour commencer</p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {blocks.map((block, index) => {
            const accessible = isBlockAccessible(block, index);
            return (
              <motion.button
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={accessible ? { scale: 1.02, y: -2 } : {}}
                whileTap={accessible ? { scale: 0.98 } : {}}
                key={block.id}
                onClick={() => {
                  if (accessible) {
                    handleSelectBlock(block);
                  } else {
                    askConfirmation(
                      "Contenu Bloqué",
                      "🔒 Débloque l'application pour accéder à tout le contenu. Voulez-vous contacter un administrateur ?",
                      () => window.open("https://wa.me/237698946202", "_blank")
                    );
                  }
                }}
                className={cn(
                  "bg-white p-6 rounded-2xl border border-gray-200/60 transition-all text-left flex flex-col gap-4 group",
                  accessible ? "hover:border-indigo-300 hover:shadow-xl hover:shadow-indigo-500/5" : "opacity-75"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0",
                    accessible ? "bg-gray-50 text-gray-400 group-hover:bg-indigo-50 group-hover:text-indigo-600" : "bg-gray-100 text-gray-300"
                  )}>
                    {accessible ? <Layers className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                  </div>
                  {accessible && block.summaryImageUrl && (
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEnlargedImage(block.summaryImageUrl);
                      }}
                      className="ml-auto w-12 h-12 rounded-lg overflow-hidden border border-gray-100 hover:border-indigo-400 transition-all cursor-zoom-in group/img"
                    >
                      <img 
                        src={block.summaryImageUrl} 
                        className="w-full h-full object-cover group-hover/img:scale-110 transition-transform" 
                        alt="Summary" 
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                  {accessible && block.videoUrl && (
                    <div 
                      className="ml-2 w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500 border border-red-100 shadow-sm"
                      title="Vidéo disponible"
                    >
                      <PlayCircle className="w-5 h-5" />
                    </div>
                  )}
                  <div className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors ml-2",
                    accessible ? "bg-gray-50 text-gray-400 group-hover:bg-indigo-100 group-hover:text-indigo-600" : "bg-gray-100 text-gray-300"
                  )}>
                    Bloc {index + 1}
                  </div>
                </div>
                <span className={cn(
                  "text-lg font-bold transition-colors",
                  accessible ? "text-gray-800 group-hover:text-indigo-700" : "text-gray-400"
                )}>{block.blockTitle || `Bloc ${index + 1}`}</span>
                {accessible ? (
                  <div className="flex items-center text-indigo-600 font-bold text-sm mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    Commencer <ArrowRight className="w-4 h-4 ml-2" />
                  </div>
                ) : (
                  <div className="mt-2 bg-gray-100 text-gray-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider w-fit">
                    Premium
                  </div>
                )}
              </motion.button>
            );
          })}
          {blocks.length === 0 && !loading && (
            <div className="col-span-full text-center text-gray-400 py-16 bg-white rounded-3xl border border-gray-200/60 border-dashed">
              <Layers className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Aucun bloc trouvé pour ce chapitre.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTraining = () => {
    if (!currentQuestion) return null;

    const questionType = currentQuestion.type || 'QCM';
    const selectedAnswer = userAnswers[currentIdx];
    const selectedArray: string[] = Array.isArray(selectedAnswer) ? selectedAnswer : (selectedAnswer ? [selectedAnswer as string] : []);
    const selectedString = typeof selectedAnswer === 'string' ? selectedAnswer : '';

    const ans = currentQuestion.answer;
    let correctLetters: string[] = [];
    let expectedAnswerString = '';
    
    if (ans) {
      if (ans.correctAnswers && ans.correctAnswers.length > 0) {
        correctLetters = ans.correctAnswers;
      } else if (ans.correctLetter) {
        correctLetters = ans.correctLetter.split(',').map((s: string) => s.trim());
      }
      if (ans.expectedAnswer) {
        expectedAnswerString = ans.expectedAnswer;
      }
    }

    const showFeedback = validated[currentIdx];

    const isAnswerCorrect = (() => {
      if (questionType === 'QROC') {
        return selectedString.trim().toLowerCase() === expectedAnswerString.trim().toLowerCase();
      } else if (questionType === 'VRAI_FAUX') {
        const normSelected = selectedArray.map(normalizeVFAnswer).filter(Boolean);
        const normCorrect = correctLetters.map(normalizeVFAnswer).filter(Boolean);
        return normSelected.length === normCorrect.length && normSelected.every(l => normCorrect.includes(l));
      } else if (questionType === 'TAB') {
        if (!currentQuestion.tableData) return false;
        const table = currentQuestion.tableData;
        const userCells = selectedAnswer && typeof selectedAnswer === 'object' && !Array.isArray(selectedAnswer)
          ? (selectedAnswer as Record<string, string>)
          : {};
        return table.blanks.every((b: any) => {
          const uVal = (userCells[`${b.rowIndex}_${b.colIndex}`] || '').trim().toLowerCase();
          const eVal = b.expectedValue.trim().toLowerCase();
          return uVal === eVal;
        });
      } else {
        return selectedArray.length === correctLetters.length && selectedArray.every(l => correctLetters.includes(l));
      }
    })();

    const handleTableCellChange = (rowIndex: number, colIndex: number, val: string) => {
      if (showFeedback) return;
      setUserAnswers(prev => {
        const currentTableAnswers = prev[currentIdx] && typeof prev[currentIdx] === 'object' && !Array.isArray(prev[currentIdx])
          ? { ...prev[currentIdx] as Record<string, string> }
          : {};
        currentTableAnswers[`${rowIndex}_${colIndex}`] = val;
        return { ...prev, [currentIdx]: currentTableAnswers };
      });
    };

    const handleOptionSelect = (val: string) => {
      if (showFeedback) return;
      if (questionType === 'QROC') {
        setUserAnswers(prev => ({ ...prev, [currentIdx]: val }));
      } else if (questionType === 'VRAI_FAUX') {
        setUserAnswers(prev => ({ ...prev, [currentIdx]: [val] }));
      } else {
        setUserAnswers(prev => {
          const current = prev[currentIdx] || [];
          const currentArray = Array.isArray(current) ? current : [current].filter(Boolean);
          if (currentArray.includes(val)) {
            return { ...prev, [currentIdx]: currentArray.filter(l => l !== val) };
          } else {
            return { ...prev, [currentIdx]: [...currentArray, val].sort() };
          }
        });
      }
    };

    const handleValidate = (e?: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
      if (e) e.preventDefault();
      
      const isTabValid = questionType === 'TAB' && (() => {
        if (!currentQuestion.tableData) return false;
        const userCells = selectedAnswer && typeof selectedAnswer === 'object' && !Array.isArray(selectedAnswer)
          ? (selectedAnswer as Record<string, string>)
          : {};
        return Object.keys(userCells).length > 0 && Object.values(userCells).some(v => v.trim() !== '');
      })();

      if (
        (questionType === 'QROC' && !selectedString.trim()) || 
        (questionType === 'TAB' && !isTabValid) ||
        (questionType !== 'QROC' && questionType !== 'TAB' && selectedArray.length === 0) || 
        showFeedback
      ) return;
      
      const isCorrect = isAnswerCorrect;
      
      setValidated(prev => ({ ...prev, [currentIdx]: true }));
      updateUserProgress(isCorrect, isCorrect ? 10 : 2, currentQuestion);
      handleErrorTracking(currentQuestion, questionType === 'QROC' ? selectedString : (questionType === 'TAB' ? JSON.stringify(selectedAnswer) : selectedArray), isCorrect);

      if (questionType === 'QROC') {
        const idxToSave = currentIdx;
        setQrocEvaluations(prev => ({
          ...prev,
          [idxToSave]: { 
            loading: false,
            disabled: true
          }
        }));
      }

      if (isPlanSession && activePlan) {
        const today = new Date().toISOString().split('T')[0];
        const currentDone = activePlan.progress?.[today] || 0;
        const newDone = currentDone + 1;
        
        // Update days array as well
        const updatedDays = (activePlan.days || []).map((day: any) => {
          if (day.date === today) {
            return { ...day, done: (day.done || 0) + 1 };
          }
          return day;
        });

        updateDoc(doc(db, 'studyPlans', activePlan.id), {
          [`progress.${today}`]: newDone,
          days: updatedDays
        }).catch(err => console.error("Error updating plan progress:", err));

        // Check if objective reached for streak update
        let backlog = 0;
        const planStartDate = new Date(activePlan.startDate);
        let checkDate = new Date(activePlan.startDate);
        const todayDate = new Date(today);
        while (checkDate < todayDate) {
          const dateStr = checkDate.toISOString().split('T')[0];
          const doneOnDate = activePlan.progress?.[dateStr] || 0;
          if (doneOnDate < activePlan.dailyTarget) {
            backlog += (activePlan.dailyTarget - doneOnDate);
          }
          checkDate.setDate(checkDate.getDate() + 1);
        }
        const currentTarget = activePlan.dailyTarget + backlog;
        
        if (newDone === currentTarget) {
          // Objective reached!
          if (userProgress) {
            const lastActive = userProgress.lastActiveDate;
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            let newStreak = userProgress.currentStreak || 0;
            if (lastActive === yesterdayStr) {
              newStreak += 1;
            } else if (lastActive !== today) {
              newStreak = 1;
            }

            updateDoc(doc(db, 'userProgress', userId), {
              currentStreak: newStreak,
              lastActiveDate: today
            });
          }
        }
      }
    };

    const nextQuestion = () => {
      if (currentIdx < questions.length - 1) {
        setCurrentIdx(prev => prev + 1);
      } else {
        if (isPlanSession) {
          setView('dashboard');
          setIsPlanSession(false);
          safeLocalStorage.removeItem(`plan_session_${userId}`);
        } else if (isErrorSession) {
          setView('errors');
          setIsErrorSession(false);
        } else {
          setView('blocks');
        }
      }
    };

    const prevQuestion = () => {
      if (currentIdx > 0) {
        setCurrentIdx(prev => prev - 1);
      }
    };

    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                if (isPlanSession) {
                  setView('dashboard');
                  setIsPlanSession(false);
                } else if (isErrorSession) {
                  setView('errors');
                  setIsErrorSession(false);
                } else {
                  setView('blocks');
                }
              }} 
              className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Quitter
            </button>

            {selectedBlock?.videoUrl && (
              <button 
                onClick={() => {
                  setCurrentVideoUrl(selectedBlock.videoUrl);
                  setShowVideoModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-colors border border-indigo-100 shrink-0"
              >
                <PlayCircle className="w-5 h-5 animate-pulse" />
                <span className="hidden sm:inline">Vidéo du cours</span>
              </button>
            )}
            
            {selectedBlock?.fichePdfUrl && (
              <button 
                onClick={() => {
                  setCurrentPdfUrl(selectedBlock.fichePdfUrl);
                  setShowPdfModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-colors border border-indigo-100 shrink-0"
              >
                <FileText className="w-5 h-5" />
                <span className="hidden sm:inline">Support PDF</span>
              </button>
            )}

            {selectedBlock?.ficheImageUrl && (
              <button 
                onClick={() => {
                  setCourseImagesVisible([selectedBlock.ficheImageUrl]);
                  setCurrentCourseIndex(0);
                  setShowCourseModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl font-bold hover:bg-emerald-100 transition-colors border border-emerald-100 shrink-0"
              >
                <BookOpen className="w-5 h-5" />
                <span className="hidden sm:inline">Fiche Image</span>
              </button>
            )}

            {selectedBlock?.mindMapText && (
              <button 
                onClick={() => {
                  const tree = parseMindMapText(selectedBlock.mindMapText);
                  if (tree) {
                    setCurrentMindMapTree(tree);
                    setShowMindMapModal(true);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-600 rounded-xl font-bold hover:bg-purple-100 transition-colors border border-purple-100 shrink-0"
              >
                <GitBranch className="w-5 h-5" />
                <span className="hidden sm:inline">Carte mentale</span>
              </button>
            )}
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>

        <div className="bg-white rounded-3xl border border-gray-200/60 shadow-sm overflow-hidden">
          <div className="h-2 bg-gray-100 w-full">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-600"
            />
          </div>
          
          <div className="p-6 md:p-10 space-y-8">
            <div className="flex items-center justify-between">
              <span className="px-4 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-black uppercase tracking-widest border border-blue-100">
                Question {currentIdx + 1} / {questions.length}
              </span>
              <div className="flex items-center gap-2 text-gray-400 font-bold text-sm">
                <Clock className="w-4 h-4" />
                <span>Entraînement libre</span>
              </div>
            </div>

            <div className="space-y-6">
              {(currentQuestion.sharedStem || currentQuestion.groupTitle) && (
                <div className="p-6 bg-amber-50/50 border border-amber-100 rounded-2xl mb-4 shadow-sm relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-400" />
                  <p className="text-sm font-bold text-amber-700 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Info className="w-4 h-4" /> {currentQuestion.groupTitle || 'Énoncé Commun'}
                  </p>
                  {currentQuestion.sharedStem && (
                    <p className="text-gray-800 font-medium leading-relaxed italic">
                      {currentQuestion.sharedStem}
                    </p>
                  )}
                </div>
              )}
              <h3 className="text-base md:text-lg font-display font-bold text-gray-900 leading-tight">
                {currentQuestion.text}
              </h3>
              
              {currentQuestion.images?.filter((img: any) => img.type === 'question').map((img: any, idx: number) => (
                <div key={idx} className="relative group cursor-zoom-in mt-[10px]" onClick={() => setEnlargedImage(img.url)}>
                  <img 
                    src={img.url} 
                    alt="Question visual" 
                    className="w-full rounded-lg border border-gray-100 shadow-md group-hover:opacity-95 transition-opacity"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 rounded-lg">
                    <div className="bg-white/90 backdrop-blur-sm p-3 rounded-full shadow-xl">
                      <Maximize2 className="w-6 h-6 text-gray-700" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {questionType === 'TAB' ? (
                <div className="mt-4 space-y-4">
                  {currentQuestion.tableData ? (
                    <div className="space-y-4">
                      {/* Sub-Header Notice */}
                      <div className="p-4 bg-indigo-50/60 rounded-2xl border border-indigo-100 flex items-start gap-2 text-indigo-900 text-xs md:text-sm font-semibold shadow-sm">
                        <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">Algorithme Minsanté : Tableau interactif reconstruit [TAB]</div>
                          <div className="text-gray-500 font-normal mt-0.5">Complétez chaque cellule beige ci-dessous. Le système validera vos réponses en temps réel à l'aide de notre modèle d'évaluation médicale.</div>
                        </div>
                      </div>

                      {/* The Table itself */}
                      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-md max-w-full">
                        <table className="min-w-full divide-y divide-gray-200 text-xs md:text-sm">
                          <thead className="bg-slate-800 text-white font-semibold">
                            <tr>
                              {currentQuestion.tableData.headers.map((h: string, idx: number) => (
                                <th key={idx} className="px-4 py-3 text-left font-bold capitalize tracking-wide border-r last:border-r-0 border-slate-700">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100 text-gray-700">
                            {(() => {
                              const rawRows = currentQuestion.tableData.rows || [];
                              const normalizedRows: string[][] = rawRows.map((r: any) => {
                                if (r && typeof r === 'object' && 'cells' in r) {
                                  return r.cells as string[];
                                }
                                return r as string[];
                              });

                              return normalizedRows.map((row: string[], rIdx: number) => (
                                <tr key={rIdx} className="hover:bg-slate-50/50 transition-colors">
                                  {row.map((cell: string, cIdx: number) => {
                                    const blankItem = currentQuestion.tableData.blanks.find((b: any) => b.rowIndex === rIdx && b.colIndex === cIdx);
                                    const cellKey = `${rIdx}_${cIdx}`;
                                    
                                    if (blankItem) {
                                      const userCells = selectedAnswer && typeof selectedAnswer === 'object' && !Array.isArray(selectedAnswer)
                                        ? (selectedAnswer as Record<string, string>)
                                        : {};
                                      const userVal = userCells[cellKey] || '';
                                      const isCellCorrect = userVal.trim().toLowerCase() === blankItem.expectedValue.trim().toLowerCase();
                                      
                                      return (
                                        <td key={cIdx} className={cn(
                                          "px-4 py-3 border-r last:border-r-0 border-gray-100 min-w-[200px] vertical-align-middle",
                                          showFeedback 
                                            ? (isCellCorrect ? "bg-emerald-50/50" : "bg-rose-50/50") 
                                            : "bg-indigo-50/25"
                                        )}>
                                          <div className="space-y-1.5">
                                            <input
                                              type="text"
                                              disabled={showFeedback}
                                              value={userVal}
                                              onChange={(e) => handleTableCellChange(rIdx, cIdx, e.target.value)}
                                              placeholder={blankItem.placeholder || "Complétez..."}
                                              className={cn(
                                                "w-full px-3 py-2 text-xs md:text-sm font-semibold rounded-lg border-2 bg-white transition-all outline-none",
                                                showFeedback
                                                  ? (isCellCorrect 
                                                      ? "border-emerald-500 text-emerald-800 focus:border-emerald-500" 
                                                      : "border-rose-400 text-rose-800 focus:border-rose-400"
                                                    )
                                                  : "border-indigo-100/80 text-gray-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                                              )}
                                            />
                                            {showFeedback && !isCellCorrect && (
                                              <div className="text-[11px] text-indigo-900 font-bold bg-white p-1.5 rounded border border-indigo-100 shadow-sm leading-tight">
                                                Attendu : <span className="underline text-indigo-700">{blankItem.expectedValue}</span>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      );
                                    } else {
                                      return (
                                        <td key={cIdx} className="px-4 py-3 border-r last:border-r-0 border-gray-100 font-medium">
                                          {cell}
                                        </td>
                                      );
                                    }
                                  })}
                                </tr>
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>
                      
                      {showFeedback && (
                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                          <p className="font-extrabold text-xs text-slate-500 uppercase tracking-wider mb-2">Explications pédagogiques :</p>
                          <p className="text-sm text-gray-700 leading-relaxed font-medium">{currentQuestion.answer?.explanation || "Consultez la correction du tableau interactif ci-dessus."}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center p-8 bg-amber-50 rounded-2xl border border-amber-200 text-amber-800 space-y-3">
                      <p className="font-bold text-sm">Structure du tableau non extraite</p>
                      <p className="text-xs">L'image de ce tableau existe mais ses éléments terminologiques n'ont pas encore été reconstruits. Veuillez vous référer à l'image du tableau ci-dessus pour y répondre libre.</p>
                      <textarea
                        disabled={showFeedback}
                        value={selectedString}
                        onChange={(e) => handleOptionSelect(e.target.value)}
                        placeholder="Tapez vos notes ou réponses ici..."
                        className="w-full p-4 rounded-xl border border-amber-300 text-gray-700 bg-white placeholder-gray-400 focus:outline-none focus:border-amber-500 min-h-[100px]"
                      />
                    </div>
                  )}
                </div>
              ) : questionType === 'QROC' ? (
                <div className="mt-4">
                  <textarea
                    disabled={showFeedback}
                    value={selectedString}
                    onChange={(e) => handleOptionSelect(e.target.value)}
                    placeholder="Tapez votre réponse ici..."
                    className={cn(
                      "w-full p-4 rounded-xl border-2 text-gray-700 bg-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-all resize-none min-h-[120px]",
                      showFeedback && "opacity-80"
                    )}
                  />
                  {showFeedback && (
                    <div className="mt-6 space-y-6">
                      {/* Original Correctness Notice */}
                      <div className={cn(
                        "p-4 rounded-xl border font-semibold flex items-start gap-3",
                        selectedString.trim().toLowerCase() === expectedAnswerString.trim().toLowerCase() 
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                          : "bg-amber-50 border-amber-200 text-amber-800"
                      )}>
                        {selectedString.trim().toLowerCase() === expectedAnswerString.trim().toLowerCase() 
                          ? <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" /> 
                          : <Info className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                        }
                        <div className="text-xs md:text-sm">
                          <div>Votre réponse : <span className="font-bold">{selectedString || "Aucune"}</span></div>
                          <div className="mt-1">Réponse attendue : <span className="font-bold text-indigo-700">{expectedAnswerString}</span></div>
                        </div>
                      </div>

                      {/* --- QROC IA EVALUATOR WORKFLOW --- */}
                      <div className="bg-gradient-to-br from-indigo-50/20 to-blue-50/10 border border-indigo-100 p-6 rounded-2xl md:p-8 space-y-6 shadow-sm">
                        <div className="flex items-center justify-between border-b border-indigo-50 pb-4">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                            <h3 className="font-black text-sm uppercase tracking-wider text-indigo-900 leading-none">Évaluation Pédagogique IA</h3>
                          </div>
                          
                          {qrocEvaluations[currentIdx] && !qrocEvaluations[currentIdx].loading && qrocEvaluations[currentIdx].score !== undefined && (
                            <div className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-xl font-black text-xs md:text-sm shadow-sm">
                              <Target className="w-3.5 h-3.5 text-indigo-200" />
                              <span>Score : {qrocEvaluations[currentIdx].score}%</span>
                            </div>
                          )}
                        </div>

                        {qrocEvaluations[currentIdx]?.loading && (
                          <div className="p-8 flex flex-col items-center justify-center gap-3">
                            <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest animate-pulse">Correction IA en cours...</p>
                          </div>
                        )}

                        {qrocEvaluations[currentIdx]?.error && (
                          <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl font-semibold text-xs flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{qrocEvaluations[currentIdx]?.error}</span>
                          </div>
                        )}

                        {qrocEvaluations[currentIdx] && !qrocEvaluations[currentIdx].loading && !qrocEvaluations[currentIdx].error && !qrocEvaluations[currentIdx].disabled && (
                          <div className="space-y-6 font-sans">
                            
                            {/* Score ring or percentage visual indicator */}
                            <div className="flex items-center justify-between bg-white/70 backdrop-blur-sm p-4 rounded-xl border border-indigo-50/80">
                              <div className="space-y-1">
                                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider">Score Pédagogique</span>
                                <p className="text-xs text-gray-500 font-medium font-sans">Évaluation globale de vos acquis médicaux.</p>
                              </div>
                              <div className="relative flex items-center justify-center shrink-0 w-16 h-16 rounded-full border-4 border-indigo-100 bg-white shadow-sm">
                                <span className="font-extrabold text-sm text-indigo-900">{qrocEvaluations[currentIdx].score}%</span>
                              </div>
                            </div>

                            {/* Strengths / Elements correctement identifies */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="p-1 rounded-md bg-emerald-100 text-emerald-800">
                                  <Check className="w-3.5 h-3.5" />
                                </div>
                                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wide">Éléments correctement identifiés</h4>
                              </div>
                              {qrocEvaluations[currentIdx].strengths && qrocEvaluations[currentIdx].strengths.length > 0 ? (
                                <ul className="space-y-1.5 pl-6 list-disc text-xs text-gray-650 font-medium">
                                  {qrocEvaluations[currentIdx].strengths.map((str, sIdx) => (
                                    <li key={sIdx}>{str}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-gray-400 italic pl-6 font-sans">Aucun élément clé n'a été spécifiquement identifié dans votre réponse.</p>
                              )}
                            </div>

                            {/* Missing points / Elements manquants */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="p-1 rounded-md bg-amber-100 text-amber-800">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                </div>
                                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wide">Éléments manquants / Améliorables</h4>
                              </div>
                              {qrocEvaluations[currentIdx].missingPoints && qrocEvaluations[currentIdx].missingPoints.length > 0 ? (
                                <ul className="space-y-1.5 pl-4 list-normal text-xs text-amber-900 font-semibold bg-amber-50/50 p-3 rounded-xl border border-amber-100/50">
                                  {qrocEvaluations[currentIdx].missingPoints.map((mp, mIdx) => (
                                    <li key={mIdx} className="flex items-start gap-1.5 font-sans">
                                      <span className="text-amber-500 shrink-0 select-none">•</span>
                                      <span>{mp}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-emerald-600 font-semibold pl-6 flex items-center gap-1 font-sans">
                                  <Check className="w-3.5 h-3.5" /> Votre réponse est exhaustive et complète !
                                </p>
                              )}
                            </div>

                            {/* Improved Answer / Reponse amelioree */}
                            {qrocEvaluations[currentIdx].improvedAnswer && (
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
                                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                                  Réponse améliorée
                                </h4>
                                <div className="p-4 bg-indigo-600/5 border border-indigo-200/50 rounded-xl text-xs text-gray-700 leading-relaxed font-semibold italic font-sans text-left">
                                  {qrocEvaluations[currentIdx].improvedAnswer}
                                </div>
                              </div>
                            )}

                            {/* Feedback pedagogique */}
                            {qrocEvaluations[currentIdx].feedback && (
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
                                  <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                                  Feedback pédagogique
                                </h4>
                                <p className="p-3 bg-white border border-gray-150 rounded-xl text-xs text-gray-650 leading-relaxed font-medium font-sans text-left">
                                  {qrocEvaluations[currentIdx].feedback}
                                </p>
                              </div>
                            )}

                          </div>
                        )}

                        {qrocEvaluations[currentIdx]?.disabled && (
                          <div className="p-5 bg-white/75 backdrop-blur-sm rounded-2xl border border-indigo-100 flex flex-col items-center text-center gap-3">
                            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-full">
                              <Info className="w-5 h-5" />
                            </div>
                            <div className="space-y-1">
                              <h4 className="text-sm font-bold text-gray-900 font-sans">Correction IA en pause</h4>
                              <p className="text-xs text-gray-500 font-medium leading-relaxed max-w-sm font-sans mx-auto">
                                L'évaluateur IA est désactivé en mode entraînement libre. Vous pouvez continuer de vous auto-évaluer en comparant votre réponse à la réponse attendue ci-dessus.
                              </p>
                            </div>
                            <div className="text-[10px] bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-bold border border-indigo-100 uppercase tracking-wide mt-1">
                              Disponible en mode Simulation et Examen Blanc
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                currentQuestion.options?.map((option: any, idx: number) => {
                  const letter = option.letter;
                  const optionText = option.text;
                  if (!optionText) return null;
                  
                  const isSelected = selectedArray.includes(letter);
                  const isCorrectLetter = questionType === 'VRAI_FAUX'
                    ? correctLetters.some(cl => normalizeVFAnswer(cl) === normalizeVFAnswer(letter))
                    : correctLetters.includes(letter);
                  
                  const isCorrectSelected = showFeedback && isSelected && isCorrectLetter;
                  const isWrongSelected = showFeedback && isSelected && !isCorrectLetter;
                  const isMissed = showFeedback && !isSelected && isCorrectLetter;

                  return (
                    <button
                      key={`${letter}-${idx}`}
                      disabled={showFeedback}
                      onClick={() => handleOptionSelect(letter)}
                      className={cn(
                        "flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left group relative overflow-hidden",
                        isSelected && !showFeedback ? "border-blue-500 bg-blue-50/50 shadow-md" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50",
                        (isCorrectSelected || isMissed) && "border-emerald-500 bg-emerald-50/50 shadow-md",
                        isWrongSelected && "border-red-500 bg-red-50/50 shadow-md"
                      )}
                    >
                      <div className={cn(
                        "w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors basis-6",
                        questionType === 'VRAI_FAUX' ? "rounded-full" : "rounded-md",
                        "border-2",
                        isSelected && !showFeedback ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300 group-hover:border-blue-400",
                        (isCorrectSelected || isMissed) && "bg-emerald-600 border-emerald-600",
                        isWrongSelected && "bg-red-600 border-red-600"
                      )}>
                        {(isSelected || isMissed) && <Check className="w-4 h-4 text-white" />}
                      </div>
                      {questionType !== 'VRAI_FAUX' && <span className="font-bold text-gray-500 w-6">{letter}.</span>}
                      <span className={cn(
                        "text-sm md:text-base font-semibold flex-1",
                        isSelected && !showFeedback ? "text-blue-900" : "text-gray-700",
                        (isCorrectSelected || isMissed) && "text-emerald-900",
                        isWrongSelected && "text-red-900"
                      )}>
                        {optionText}
                      </span>
                      
                      {(isCorrectSelected || isMissed) && <CheckCircle2 className="w-6 h-6 text-emerald-600 animate-in zoom-in shrink-0" />}
                      {isWrongSelected && <XCircle className="w-6 h-6 text-red-600 animate-in zoom-in shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            {!showFeedback && (
              <button
                type="button"
                onClick={handleValidate}
                disabled={
                  questionType === 'QROC' ? !selectedString.trim() : 
                  questionType === 'TAB' ? !(selectedAnswer && typeof selectedAnswer === 'object' && !Array.isArray(selectedAnswer) && Object.values(selectedAnswer).some(v => (v as string).trim() !== '')) :
                  selectedArray.length === 0
                }
                className="w-full mt-6 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 relative z-10 cursor-pointer touch-action-manipulation"
              >
                Valider
              </button>
            )}

            <div className="fixed top-1/2 -translate-y-1/2 left-0 right-0 z-50 flex items-center justify-between px-2 md:px-8 pointer-events-none">
              <button
                onClick={prevQuestion}
                disabled={currentIdx === 0}
                className="pointer-events-auto flex items-center justify-center gap-2 p-4 md:px-6 md:py-3 rounded-full md:rounded-xl font-bold bg-white text-gray-600 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="w-6 h-6 md:w-5 md:h-5" /> <span className="hidden md:inline">Précédent</span>
              </button>
              
              <button
                onClick={nextQuestion}
                className="pointer-events-auto flex items-center justify-center gap-2 p-4 md:px-6 md:py-3 rounded-full md:rounded-xl font-bold bg-white text-indigo-600 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-indigo-100 hover:bg-indigo-50 transition-colors"
              >
                <span className="hidden md:inline">{currentIdx < questions.length - 1 ? "Suivant" : "Terminer"}</span> <ArrowRight className="w-6 h-6 md:w-5 md:h-5" />
              </button>
            </div>

            <AnimatePresence>
              {showFeedback && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "p-6 rounded-2xl border-2 space-y-3",
                    isAnswerCorrect
                      ? "bg-emerald-50 border-emerald-100" 
                      : "bg-red-50 border-red-100"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      isAnswerCorrect ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                    )}>
                      {isAnswerCorrect ? <Trophy className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                    </div>
                    <h4 className={cn(
                      "text-lg font-bold",
                      isAnswerCorrect ? "text-emerald-900" : "text-red-900"
                    )}>
                      {isAnswerCorrect ? "Excellent !" : "Pas tout à fait..."}
                    </h4>
                  </div>
                  <p className="text-gray-700 font-medium leading-relaxed">
                    {currentQuestion.answer?.explanation}
                  </p>
                  {currentQuestion.images?.filter((img: any) => img.type === 'answer').map((img: any, idx: number) => (
                    <div key={idx} className="relative group cursor-zoom-in mt-[10px]" onClick={() => setEnlargedImage(img.url)}>
                      <img 
                        src={img.url} 
                        alt="Answer visual" 
                        className="w-full rounded-lg border border-gray-100 shadow-md group-hover:opacity-95 transition-opacity"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 rounded-lg">
                        <div className="bg-white/90 backdrop-blur-sm p-3 rounded-full shadow-xl">
                          <Maximize2 className="w-6 h-6 text-gray-700" />
                        </div>
                      </div>
                    </div>
                  ))}

                  {(currentQuestion.courseImages?.length > 0 || selectedBlock?.fichePdfUrl || selectedBlock?.ficheImageUrl) && (
                    <div className="flex flex-col sm:flex-row gap-3 mt-6">
                      {(currentQuestion.courseImages?.length > 0 || selectedBlock?.ficheImageUrl) && (
                        <button 
                          onClick={() => {
                            const allImages = [...(currentQuestion.courseImages || [])];
                            if (selectedBlock?.ficheImageUrl && !allImages.includes(selectedBlock.ficheImageUrl)) {
                              allImages.push(selectedBlock.ficheImageUrl);
                            }
                            setCourseImagesVisible(allImages);
                            setCurrentCourseIndex(0);
                            setShowCourseModal(true);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-black py-4 px-4 rounded-2xl transition-all shadow-sm border border-emerald-100 active:scale-95"
                        >
                          <BookOpen className="w-5 h-5" /> Fiche de cours
                        </button>
                      )}
                      
                      {selectedBlock?.fichePdfUrl && (
                        <button 
                          onClick={() => {
                            setCurrentPdfUrl(selectedBlock.fichePdfUrl);
                            setShowPdfModal(true);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-black py-4 px-4 rounded-2xl transition-all shadow-sm border border-indigo-100 active:scale-95"
                        >
                          <FileText className="w-5 h-5" /> Support PDF
                        </button>
                      )}

                      {currentQuestion.courseVideos && currentQuestion.courseVideos.length > 0 && (
                        <button 
                          onClick={() => {
                            setCurrentVideoUrl(currentQuestion.courseVideos[0]);
                            setShowVideoModal(true);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-800 font-black py-4 px-4 rounded-2xl transition-all shadow-sm border border-blue-100 active:scale-95"
                        >
                          <PlayCircle className="w-5 h-5" /> Voir la vidéo
                        </button>
                      )}
                      
                      {selectedBlock?.videoUrl && (!currentQuestion.courseVideos || currentQuestion.courseVideos.length === 0) && (
                        <button 
                          onClick={() => {
                            setCurrentVideoUrl(selectedBlock.videoUrl);
                            setShowVideoModal(true);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-800 font-black py-4 px-4 rounded-2xl transition-all shadow-sm border border-blue-100 active:scale-95"
                        >
                          <PlayCircle className="w-5 h-5" /> Vidéo Cours
                        </button>
                      )}
                    </div>
                  )}

                  {!currentQuestion.courseImages && currentQuestion.courseVideos && currentQuestion.courseVideos.length > 0 && (
                    <button 
                      onClick={() => {
                        setCurrentVideoUrl(currentQuestion.courseVideos[0]);
                        setShowVideoModal(true);
                      }}
                      className="mt-6 w-full flex items-center justify-center gap-2 bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold py-4 px-4 rounded-xl transition-colors shadow-sm"
                    >
                      <PlayCircle className="w-5 h-5" /> Voir la vidéo
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  };

  const renderErrorsModeSelection = () => {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour
            </button>
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>

        <header className="space-y-4 text-center py-8">
          <h2 className="text-4xl font-display font-black text-gray-900 tracking-tight">Mes Erreurs & Révisions</h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">Analysez vos points faibles et repassez vos examens pour vous perfectionner.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.button
            whileHover={{ y: -5, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setView('redo_missed_questions')}
            className="group relative bg-white p-8 rounded-[2.5rem] border-2 border-gray-100 hover:border-red-500 shadow-xl shadow-gray-200/50 transition-all text-left overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-bl-full -z-10 group-hover:bg-red-100 transition-colors" />
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">❌ Questions ratées</h3>
            <p className="text-gray-500 leading-relaxed">
              Repassez uniquement les questions sur lesquelles vous avez échoué lors de vos entraînements.
            </p>
            <div className="mt-8 flex items-center gap-2 text-red-600 font-bold">
              Réviser <ChevronRight className="w-5 h-5" />
            </div>
          </motion.button>

          <motion.button
            whileHover={isDemo ? {} : { y: -5, scale: 1.02 }}
            whileTap={isDemo ? {} : { scale: 0.98 }}
            onClick={() => {
              if (isDemo) {
                askConfirmation(
                  "Accès Premium Requis",
                  "L'accès aux examens blancs est réservé aux membres premium. Voulez-vous débloquer l'accès complet ?",
                  () => window.open('https://wa.me/237656534563', '_blank')
                );
              } else {
                setView('retake_past_exams');
              }
            }}
            className={cn(
              "group relative p-8 rounded-[2.5rem] border-2 shadow-xl shadow-gray-200/50 transition-all text-left overflow-hidden",
              isDemo ? "bg-gray-50 border-gray-200 cursor-not-allowed" : "bg-white border-gray-100 hover:border-indigo-500"
            )}
          >
            <div className={cn(
              "absolute top-0 right-0 w-32 h-32 rounded-bl-full -z-10 transition-colors",
              isDemo ? "bg-gray-100" : "bg-indigo-50 group-hover:bg-indigo-100"
            )} />
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center mb-6 transition-transform",
              isDemo ? "bg-gray-200" : "bg-indigo-100 group-hover:scale-110"
            )}>
              {isDemo ? <Lock className="w-8 h-8 text-gray-400" /> : <RotateCcw className="w-8 h-8 text-indigo-600" />}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className={cn("text-2xl font-bold", isDemo ? "text-gray-400" : "text-gray-900")}>🔄 Recomposer un examen</h3>
              {isDemo && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-black rounded-full uppercase tracking-wider">Premium</span>}
            </div>
            <p className="text-gray-500 leading-relaxed">
              Retentez les examens blancs passés pour améliorer votre score et votre gestion du temps.
            </p>
            <div className={cn("mt-8 flex items-center gap-2 font-bold", isDemo ? "text-gray-400" : "text-indigo-600")}>
              {isDemo ? "Contenu verrouillé" : "Voir les examens"} <ChevronRight className="w-5 h-5" />
            </div>
          </motion.button>
        </div>
      </div>
    );
  };

  const renderRedoMissedQuestions = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('errors')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour
            </button>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
              <XCircle className="w-8 h-8 text-red-600" />
              Mes erreurs
            </h1>
          </div>
        </div>

        <div className="bg-white p-6 md:p-8 rounded-3xl border border-gray-200 shadow-sm">
          {/* Debug UI */}
          <div className="mb-4 p-2 bg-gray-100 rounded-lg text-xs font-mono text-gray-500">
            Debug: {userErrors.length} erreurs chargées pour l'utilisateur {userId}
          </div>

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Questions à revoir</h2>
              <p className="text-gray-500 mt-1">
                Vous avez <span className="font-bold text-red-600">{userErrors.length}</span> erreur{userErrors.length > 1 ? 's' : ''} à revoir.
              </p>
            </div>
            <button
              onClick={handleStartErrorSession}
              disabled={userErrors.length === 0 || loading}
              className="px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              Démarrer la révision
            </button>
          </div>

          {userErrors.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Aucune erreur à revoir !</h3>
              <p className="text-gray-500 mt-2">Continuez votre entraînement pour progresser.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {userErrors.map((error, idx) => (
                <div key={error.id} className="p-4 rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center font-bold">
                      <X className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">Question {error.questionId.slice(-4)}</p>
                      <p className="text-sm text-gray-500">
                        Dernière erreur le {new Date(error.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderProgression = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour au Dashboard
            </button>
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>

        {/* Sub-navigation Tabs */}
        <div className="flex p-1 bg-gray-100 rounded-2xl w-fit mx-auto md:mx-0">
          <button
            onClick={() => setProgressionSubView('internal')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2",
              progressionSubView === 'internal' 
                ? "bg-white text-indigo-600 shadow-sm" 
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <BarChart3 className="w-4 h-4" /> Progression Interne
          </button>
          <button
            onClick={() => setProgressionSubView('leaderboard')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2",
              progressionSubView === 'leaderboard' 
                ? "bg-white text-indigo-600 shadow-sm" 
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Trophy className="w-4 h-4" /> Classement
          </button>
        </div>

        {progressionSubView === 'leaderboard' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Weekly Leaderboard / Last Exam Leaderboard */}
            <header className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-yellow-50 to-amber-50 rounded-bl-full -z-10 opacity-50" />
              <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="space-y-4 flex-1 text-center md:text-left">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wider">
                    <Trophy className="w-4 h-4" /> Classement de la Semaine
                  </div>
                  <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">
                    Top Performeurs
                  </h2>
                  <p className="text-gray-500 font-medium">Les meilleurs étudiants des 7 derniers jours.</p>
                </div>
                
                {/* Podium */}
                {weeklyLeaderboard.length > 0 ? (
                  <div className="flex items-end justify-center gap-2 md:gap-4 h-48 mt-8 md:mt-0">
                    {/* 2nd Place */}
                    {weeklyLeaderboard[1] ? (
                      <div className="flex flex-col items-center animate-in slide-in-from-bottom-8 duration-700 delay-100">
                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center font-bold text-gray-600 mb-2 border-2 border-gray-200 shadow-sm">
                          {weeklyLeaderboard[1].userName?.charAt(0).toUpperCase()}
                        </div>
                        <div className="w-20 md:w-24 h-24 bg-gradient-to-t from-gray-200 to-gray-100 rounded-t-xl flex flex-col items-center justify-start pt-3 border-t-4 border-gray-300 shadow-inner">
                          <span className="text-2xl font-black text-gray-400">2</span>
                          <span className="text-xs font-bold text-gray-600 mt-1 truncate w-full text-center px-1">{weeklyLeaderboard[1].userName}</span>
                          <span className="text-sm font-black text-gray-800">{weeklyLeaderboard[1].score} pts</span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-20 md:w-24 h-24 bg-gray-50 rounded-t-xl border-t-4 border-gray-100 opacity-50" />
                    )}
                    
                    {/* 1st Place */}
                    {weeklyLeaderboard?.[0] && (
                      <div className="flex flex-col items-center animate-in slide-in-from-bottom-8 duration-700">
                        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center font-bold text-yellow-600 mb-2 border-4 border-yellow-300 shadow-md relative">
                          <Crown className="w-8 h-8 absolute -top-6 text-yellow-500 drop-shadow-sm" />
                          {weeklyLeaderboard[0].userName?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="w-24 md:w-28 h-32 bg-gradient-to-t from-yellow-200 to-yellow-100 rounded-t-xl flex flex-col items-center justify-start pt-3 border-t-4 border-yellow-400 shadow-inner">
                          <span className="text-3xl font-black text-yellow-600">1</span>
                          <span className="text-xs font-bold text-yellow-800 mt-1 truncate w-full text-center px-1">{weeklyLeaderboard[0].userName}</span>
                          <span className="text-base font-black text-yellow-900">{weeklyLeaderboard[0].score} pts</span>
                        </div>
                      </div>
                    )}

                    {/* 3rd Place */}
                    {weeklyLeaderboard[2] ? (
                      <div className="flex flex-col items-center animate-in slide-in-from-bottom-8 duration-700 delay-200">
                        <div className="w-12 h-12 bg-orange-50 rounded-full flex items-center justify-center font-bold text-orange-600 mb-2 border-2 border-orange-200 shadow-sm">
                          {weeklyLeaderboard[2].userName?.charAt(0).toUpperCase()}
                        </div>
                        <div className="w-20 md:w-24 h-20 bg-gradient-to-t from-orange-200 to-orange-100 rounded-t-xl flex flex-col items-center justify-start pt-3 border-t-4 border-orange-300 shadow-inner">
                          <span className="text-2xl font-black text-orange-500">3</span>
                          <span className="text-xs font-bold text-orange-700 mt-1 truncate w-full text-center px-1">{weeklyLeaderboard[2].userName}</span>
                          <span className="text-sm font-black text-orange-900">{weeklyLeaderboard[2].score} pts</span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-20 md:w-24 h-20 bg-gray-50 rounded-t-xl border-t-4 border-gray-100 opacity-50" />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 w-full md:w-auto bg-gray-50 rounded-2xl border border-gray-100 px-8 text-gray-400 font-medium">
                    Aucun résultat cette semaine
                  </div>
                )}
              </div>
            </header>

            {/* Historique des classements */}
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
              <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <History className="w-6 h-6 text-indigo-500" /> Historique de vos Classements
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="pb-4 font-bold text-gray-500 text-sm uppercase tracking-wider">Examen</th>
                      <th className="pb-4 font-bold text-gray-500 text-sm uppercase tracking-wider">Date</th>
                      <th className="pb-4 font-bold text-gray-500 text-sm uppercase tracking-wider">Score</th>
                      <th className="pb-4 font-bold text-gray-500 text-sm uppercase tracking-wider">Rang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {userExamHistory.length > 0 ? (
                      userExamHistory.map((attempt) => (
                        <tr key={attempt.id} className="hover:bg-gray-50 transition-colors">
                          <td className="py-4 font-bold text-gray-900">{attempt.examTitle}</td>
                          <td className="py-4 text-gray-500 text-sm">
                            {new Date(attempt.createdAt).toLocaleDateString('fr-FR')}
                          </td>
                          <td className="py-4 font-black text-indigo-600">{attempt.score} pts</td>
                          <td className="py-4">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-xs font-black",
                              attempt.rank === 1 ? "bg-yellow-100 text-yellow-700" :
                              attempt.rank <= 3 ? "bg-gray-100 text-gray-700" :
                              "bg-indigo-50 text-indigo-600"
                            )}>
                              #{attempt.rank}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-gray-400 font-medium">
                          Vous n'avez pas encore participé à des examens blancs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Revision Stats Cards with Question Categories */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-6 rounded-3xl border border-blue-100 shadow-sm flex items-center gap-4 group hover:shadow-md transition-all">
                <div className="p-4 bg-blue-105 text-blue-600 rounded-2xl group-hover:scale-110 transition-transform bg-blue-50">
                  <CheckSquare className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">QCM traités</p>
                  <p className="text-2xl font-black text-gray-900 mt-1">
                    {userProgress?.qcmAnswered || 0}
                    <span className="text-sm font-extrabold text-emerald-600 ml-2">
                       ({(userProgress?.qcmAnswered || 0) > 0 ? Math.round(((userProgress?.qcmCorrect || 0) / (userProgress?.qcmAnswered || 1)) * 100) : 0}%)
                    </span>
                  </p>
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm flex items-center gap-4 group hover:shadow-md transition-all">
                <div className="p-4 bg-indigo-105 text-indigo-600 rounded-2xl group-hover:scale-110 transition-transform bg-indigo-50">
                  <ToggleLeft className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">VRAI/FAUX traités</p>
                  <p className="text-2xl font-black text-gray-900 mt-1">
                    {userProgress?.vraiFauxAnswered || 0}
                    <span className="text-sm font-extrabold text-indigo-600 ml-2">
                       ({(userProgress?.vraiFauxAnswered || 0) > 0 ? Math.round(((userProgress?.vraiFauxCorrect || 0) / (userProgress?.vraiFauxAnswered || 1)) * 100) : 0}%)
                    </span>
                  </p>
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-purple-100 shadow-sm flex items-center gap-4 group hover:shadow-md transition-all">
                <div className="p-4 bg-purple-105 text-purple-600 rounded-2xl group-hover:scale-110 transition-transform bg-purple-50">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">QROC traités</p>
                  <p className="text-2xl font-black text-gray-900 mt-1">{userProgress?.qrocAnswered || 0}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-6 rounded-3xl border border-emerald-100 shadow-sm flex items-center gap-4 group hover:shadow-md transition-all">
                <div className="p-4 bg-emerald-100 text-emerald-600 rounded-2xl group-hover:scale-110 transition-transform">
                  <BookOpen className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Fiches consultées</p>
                  <p className="text-3xl font-black text-gray-900">{userProgress?.fichesViewed || 0}</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-blue-100 shadow-sm flex items-center gap-4 group hover:shadow-md transition-all">
                <div className="p-4 bg-blue-100 text-blue-600 rounded-2xl group-hover:scale-110 transition-transform">
                  <MonitorPlay className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Vidéos visionnées</p>
                  <p className="text-3xl font-black text-gray-900">{userProgress?.videosViewed || 0}</p>
                </div>
              </div>
            </div>

            {/* Decidated IA QROC Stats Dashboard Section */}
            <div className="bg-gradient-to-tr from-indigo-950 to-slate-950 p-6 md:p-8 rounded-3xl text-white shadow-xl relative overflow-hidden font-sans border border-slate-800">
              <div className="absolute top-0 right-0 w-80 h-80 bg-radial-gradient from-indigo-500/10 to-transparent rounded-bl-full pointer-events-none" />
              
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-6 border-b border-white/10">
                <div className="space-y-1.5 text-left">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-505/20 text-indigo-300 rounded-full text-[10px] font-black uppercase tracking-wider border border-indigo-500/30 bg-indigo-500/10">
                    <Sparkles className="w-3.5 h-3.5" /> Service IA QROCEvaluator
                  </div>
                  <h3 className="text-xl font-bold tracking-tight text-white font-sans font-display">Statistiques des QROC corrigées par IA</h3>
                  <p className="text-xs text-indigo-200">Suivi détaillé de vos performances sur les questions à réponses ouvertes.</p>
                </div>
                
                <div className="flex items-center gap-3 bg-white/5 backdrop-blur-sm px-4 py-2 rounded-2xl border border-white/10 shrink-0">
                  <GraduationCap className="w-5 h-5 text-indigo-400" />
                  <div className="text-left font-sans">
                    <p className="text-[9px] font-bold text-indigo-300 uppercase tracking-widest">Score Moyen Global</p>
                    <p className="text-lg font-black text-white leading-tight">{qrocStats ? qrocStats.avgScore : 0}%</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6">
                
                {/* Num evaluated */}
                <div className="space-y-1 bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-colors text-left">
                  <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">Questions Évaluées</span>
                  <div className="flex items-baseline gap-1 mt-1 font-sans">
                    <span className="text-3xl font-black text-white">{qrocStats ? qrocStats.count : 0}</span>
                    <span className="text-xs text-indigo-200">médicales</span>
                  </div>
                </div>

                {/* Avg Score */}
                <div className="space-y-1 bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-colors text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest font-sans">Score Moyen</span>
                    <Target className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="flex items-baseline gap-1 mt-1 font-sans">
                    <span className="text-3xl font-black text-white">{qrocStats ? qrocStats.avgScore : 0}%</span>
                    <span className="text-xs text-indigo-200">de réussite</span>
                  </div>
                </div>

                {/* Max Score */}
                <div className="space-y-1 bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-colors text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest font-sans">Meilleur Score</span>
                    <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                  </div>
                  <div className="flex items-baseline gap-1 mt-1 font-sans">
                    <span className="text-3xl font-black text-white">{qrocStats ? qrocStats.maxScore : 0}%</span>
                    <span className="text-xs text-indigo-200">historique</span>
                  </div>
                </div>

              </div>

              {/* History progression charts simple timeline */}
              {qrocStats && qrocStats.history && qrocStats.history.length > 0 && (
                <div className="mt-8 space-y-3 pt-6 border-t border-white/10 text-left">
                  <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest font-sans">Historique de Progression QROC</span>
                  <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    {qrocStats.history.slice(-8).map((h, hIdx) => (
                      <div key={hIdx} className="bg-white/5 px-3 py-2 rounded-xl flex items-center gap-2 border border-white/5 shrink-0 min-w-[120px] text-left">
                        <div className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          h.score >= 70 ? "bg-emerald-400" : h.score >= 50 ? "bg-amber-400" : "bg-red-400"
                        )} />
                        <div className="font-sans">
                          <p className="text-[9px] text-gray-400 leading-none">{new Date(h.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</p>
                          <p className="text-xs font-bold text-white mt-1 leading-none">{h.score}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sub-sub-navigation for Internal Progression */}
            <div className="flex gap-1.5 p-1 bg-gray-100 rounded-2xl w-fit mx-auto md:mx-0 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setInternalSubView('badges')}
                className={cn(
                  "px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 whitespace-nowrap",
                  internalSubView === 'badges' 
                    ? "bg-white text-indigo-600 shadow-sm" 
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                <Award className="w-4 h-4" /> Badges
              </button>
              <button
                onClick={() => setInternalSubView('objectifs')}
                className={cn(
                  "px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 whitespace-nowrap",
                  internalSubView === 'objectifs' 
                    ? "bg-white text-indigo-600 shadow-sm" 
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                <Target className="w-4 h-4" /> Objectifs
              </button>
              <button
                onClick={() => setInternalSubView('livres')}
                className={cn(
                  "px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 whitespace-nowrap",
                  internalSubView === 'livres' 
                    ? "bg-white text-indigo-600 shadow-sm" 
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                <Book className="w-4 h-4" /> Par livre
              </button>
            </div>

            {internalSubView === 'objectifs' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {activePlan && activePlan.days && activePlan.days.length > 0 && (
                  <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      <Calendar className="w-6 h-6 text-indigo-500" /> Vos Objectifs Journaliers
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {activePlan.days.map((day: any, index: number) => {
                        const isToday = day.date === new Date().toISOString().split('T')[0];
                        const isPast = new Date(day.date) < new Date(new Date().toISOString().split('T')[0]);
                        const isCompleted = day.done >= day.target;
                        
                        return (
                          <div key={index} className={cn(
                            "p-6 rounded-2xl border transition-all",
                            isToday ? "border-indigo-500 bg-indigo-50 shadow-md" : 
                            isCompleted ? "border-green-200 bg-green-50" : 
                            isPast ? "border-red-200 bg-red-50" : "border-gray-100 bg-gray-50"
                          )}>
                            <div className="flex justify-between items-start mb-4">
                              <div className="space-y-1">
                                <h4 className={cn("font-bold", isToday ? "text-indigo-900" : "text-gray-900")}>
                                  {new Date(day.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}
                                </h4>
                                {isToday && <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Aujourd'hui</span>}
                              </div>
                              <div className={cn(
                                "w-10 h-10 rounded-full flex items-center justify-center",
                                isCompleted ? "bg-green-100 text-green-600" : 
                                isPast ? "bg-red-100 text-red-600" : "bg-gray-200 text-gray-500"
                              )}>
                                {isCompleted ? <CheckCircle2 className="w-6 h-6" /> : <Target className="w-6 h-6" />}
                              </div>
                            </div>
                            
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm font-bold">
                                <span className="text-gray-500">Progression</span>
                                <span className={isCompleted ? "text-green-600" : "text-gray-900"}>{day.done || 0} / {day.target} QCM</span>
                              </div>
                              <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                                <div 
                                  className={cn("h-full transition-all duration-500", isCompleted ? "bg-green-500" : isPast ? "bg-red-500" : "bg-indigo-500")}
                                  style={{ width: `${Math.min(((day.done || 0) / day.target) * 100, 100)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {plans.length > 0 && (
                  <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      <Calendar className="w-6 h-6 text-indigo-500" /> Vos Programmes
                    </h3>
                    <div className="space-y-4">
                      {plans.map(plan => {
                        const progressPercent = plan.totalQuestions > 0 ? Math.round((plan.progress?.completedQuestions || 0) / plan.totalQuestions * 100) : 0;
                        const today = new Date().toISOString().split('T')[0];
                        const dailyDone = plan.progress?.dailyProgress?.[today] || 0;
                        const dailyTarget = plan.questionsPerDay;
                        
                        return (
                          <div key={plan.id} className="p-6 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-4">
                            <div className="flex justify-between items-start">
                              <div>
                                <h4 className="font-bold text-gray-900 text-lg">{plan.title}</h4>
                                <p className="text-sm text-gray-500">Objectif: {plan.endDate}</p>
                              </div>
                              <div className="bg-white px-3 py-1 rounded-full border border-gray-200 text-sm font-bold text-indigo-600">
                                {progressPercent}% complété
                              </div>
                            </div>
                            
                            <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-indigo-600 transition-all duration-500"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                              <div className="bg-white p-4 rounded-xl border border-gray-100">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aujourd'hui</p>
                                <div className="flex items-end gap-2">
                                  <span className="text-2xl font-black text-gray-900 leading-none">{dailyDone}</span>
                                  <span className="text-sm font-bold text-gray-400 mb-0.5">/ {dailyTarget} QCM</span>
                                </div>
                              </div>
                              <div className="bg-white p-4 rounded-xl border border-gray-100">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Série</p>
                                <div className="flex items-center gap-2">
                                  <Flame className={cn("w-5 h-5", plan.progress?.streak > 0 ? "text-orange-500" : "text-gray-300")} />
                                  <span className="text-2xl font-black text-gray-900 leading-none">{plan.progress?.streak || 0}</span>
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() => handleStartDailyPlan(plan)}
                              className={cn(
                                "w-full mt-4 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
                                dailyDone >= dailyTarget 
                                  ? "bg-green-100 text-green-700 hover:bg-green-200" 
                                  : "bg-indigo-600 text-white hover:bg-indigo-700"
                              )}
                            >
                              {dailyDone >= dailyTarget ? <><CheckCircle2 className="w-5 h-5" /> Objectif atteint - Continuer</> : "▶ Commencer les QCM du jour"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {internalSubView === 'livres' && (
              <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {!selectedBookForDetails ? (
                  <>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <Book className="w-6 h-6 text-indigo-500" /> Progression par Livre
                      </h3>
                      <p className="text-sm text-gray-500">Suivez votre taux de complétion pour chaque ouvrage. Cliquez sur un livre pour voir les détails par chapitre.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {books.map(book => {
                        const total = booksTotalQuestions[book.id] || 0;
                        const answered = userProgress?.byBook?.[book.id]?.answered || 0;
                        const percent = total > 0 ? Math.min(Math.round((answered / total) * 100), 100) : 0;
                        
                        // Dynamic color logic
                        let colorClass = "bg-red-500";
                        let textClass = "text-red-600";
                        let bgClass = "bg-red-50";
                        
                        if (percent >= 90) {
                          colorClass = "bg-emerald-500";
                          textClass = "text-emerald-600";
                          bgClass = "bg-emerald-50";
                        } else if (percent >= 60) {
                          colorClass = "bg-blue-500";
                          textClass = "text-blue-600";
                          bgClass = "bg-blue-50";
                        } else if (percent >= 30) {
                          colorClass = "bg-orange-500";
                          textClass = "text-orange-600";
                          bgClass = "bg-orange-50";
                        }

                        return (
                          <div 
                            key={book.id} 
                            onClick={() => setSelectedBookForDetails(book.id)}
                            className="p-6 rounded-2xl border border-gray-100 bg-gray-50/30 space-y-4 hover:shadow-md transition-all cursor-pointer group"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-3">
                                <div className={cn("p-2 rounded-lg transition-colors", bgClass, textClass, "group-hover:bg-opacity-80")}>
                                  <Book className="w-5 h-5" />
                                </div>
                                <h4 className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">{book.name}</h4>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className={cn("font-black text-lg", textClass)}>{percent}%</span>
                                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 transition-all group-hover:translate-x-1" />
                              </div>
                            </div>
                            
                            <div className="space-y-2">
                              <div className="w-full bg-gray-200 h-3 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${percent}%` }}
                                  className={cn("h-full transition-all duration-1000", colorClass)}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                <span>{answered} questions</span>
                                <span>{total} total</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                    <div className="flex items-center justify-between">
                      <button 
                        onClick={() => setSelectedBookForDetails(null)}
                        className="flex items-center gap-2 text-gray-500 hover:text-gray-900 font-bold transition-all group"
                      >
                        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour aux livres
                      </button>
                      <div className="text-right">
                        <h3 className="text-xl font-bold text-gray-900">
                          {books.find(b => b.id === selectedBookForDetails)?.name}
                        </h3>
                        <p className="text-sm text-gray-500">Détails par chapitre</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {allChapters
                        .filter(c => c.bookId === selectedBookForDetails)
                        .map(chapter => {
                          const total = chaptersTotalQuestions[chapter.id] || 0;
                          const answered = userProgress?.byChapter?.[chapter.id]?.answered || 0;
                          const percent = total > 0 ? Math.min(Math.round((answered / total) * 100), 100) : 0;
                          
                          let colorClass = "bg-indigo-500";
                          if (percent >= 100) colorClass = "bg-emerald-500";
                          else if (percent === 0) colorClass = "bg-gray-300";

                          return (
                            <div key={chapter.id} className="p-5 rounded-2xl border border-gray-100 bg-gray-50/20 space-y-3">
                              <div className="flex justify-between items-center">
                                <h4 className="font-bold text-gray-800 text-sm">{chapter.title}</h4>
                                <span className={cn("text-sm font-black", percent >= 100 ? "text-emerald-600" : "text-indigo-600")}>
                                  {percent}%
                                </span>
                              </div>
                              <div className="space-y-1.5">
                                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${percent}%` }}
                                    className={cn("h-full transition-all duration-700", colorClass)}
                                  />
                                </div>
                                <div className="flex justify-between text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                                  <span>{answered} / {total} questions</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {internalSubView === 'badges' && (
              <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Award className="w-6 h-6 text-amber-500" /> Vos Badges
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { id: 'first_100_questions', label: '100 Questions', icon: <Target className="w-8 h-8" />, color: 'blue' },
                    { id: '7_day_streak', label: '7 Jours 🔥', icon: <Flame className="w-8 h-8" />, color: 'orange' },
                    { id: 'high_accuracy', label: '80% Précision', icon: <Star className="w-8 h-8" />, color: 'amber' },
                    { id: 'chapter_master', label: 'Maître Chapitre', icon: <Book className="w-8 h-8" />, color: 'indigo' }
                  ].map(badge => {
                    const isUnlocked = userProgress?.badges?.includes(badge.id);
                    return (
                      <div key={badge.id} className={cn(
                        "flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all",
                        isUnlocked ? "bg-white border-amber-200 shadow-md" : "bg-gray-50 border-gray-100 opacity-40 grayscale"
                      )}>
                        <div className={cn(
                          "mb-3 p-3 rounded-xl",
                          isUnlocked ? "bg-amber-50 text-amber-600" : "bg-gray-200 text-gray-400"
                        )}>
                          {badge.icon}
                        </div>
                        <p className="text-sm font-bold text-center text-gray-800">{badge.label}</p>
                        {!isUnlocked && <p className="text-[10px] font-bold text-gray-400 uppercase mt-1">Verrouillé</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Automatic cleanup of expired plans
  const isCleaningUpPlans = useRef(false);
  useEffect(() => {
    if (!userId || isDemo || plans.length === 0 || isCleaningUpPlans.current) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const expiredPlans = plans.filter(plan => {
      if (plan.status !== 'active') return false;
      // If no endDate, we skip
      if (!plan.endDate) return false;
      const endDate = new Date(plan.endDate);
      endDate.setHours(23, 59, 59, 999); // Allow until the end of the day
      return endDate < today;
    });
    
    if (expiredPlans.length > 0) {
      const cleanupPlans = async () => {
        isCleaningUpPlans.current = true;
        try {
          const batch = writeBatch(db);
          expiredPlans.forEach(plan => {
            const planRef = doc(db, 'studyPlans', plan.id);
            batch.update(planRef, { status: 'expired' });
          });
          await batch.commit();
          console.log(`${expiredPlans.length} plans marqués comme expirés`);
        } catch (e) {
          console.error("Erreur durant le nettoyage auto des plans", e);
        } finally {
          isCleaningUpPlans.current = false;
        }
      };
      cleanupPlans();
    }
  }, [plans, userId, isDemo]);

  const handleDeletePlan = async () => {
    if (!activePlan || !userId) return;
    handleDeleteAnyPlan(activePlan.id);
  };

  const handleDeleteAnyPlan = async (planId: string) => {
    if (!userId) return;
    if (!window.confirm("Voulez-vous vraiment supprimer cette planification ?")) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'studyPlans', planId), { status: 'cancelled' });
      if (activePlan?.id === planId) {
        setActivePlan(null);
        safeLocalStorage.removeItem(`plan_session_${userId}`);
      }
      // The plans list will be updated automatically via the onSnapshot listener if it's set up, 
      // or we can manually update the state here if needed.
    } catch (e) {
      console.error(e);
      alert("Erreur lors de la suppression de la planification.");
    } finally {
      setLoading(false);
    }
  };

  const renderPlanning = () => {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour au Dashboard
            </button>
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>
        <header className="bg-white p-8 rounded-3xl border border-indigo-100 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-bl-full -z-10 opacity-50" />
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 bg-indigo-50 rounded-2xl">
              <Calendar className="w-8 h-8 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Planification</h2>
              <p className="text-gray-500 font-medium">Organisez votre préparation pour réussir vos examens.</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8">
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 border-b pb-2">Configuration de l'objectif</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Date de fin (Examen)</label>
                    <input 
                      type="date" 
                      className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={userPlanning?.endDate || ''}
                      onChange={(e) => {
                        const newPlanning = { ...(userPlanning || {}), endDate: e.target.value };
                        setUserPlanning(newPlanning);
                        setDoc(doc(db, 'userPlanning', userId), newPlanning);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Fréquence (jours/semaine)</label>
                    <select 
                      className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={userPlanning?.frequencyDaysPerWeek || 7}
                      onChange={(e) => {
                        const newPlanning = { ...(userPlanning || {}), frequencyDaysPerWeek: parseInt(e.target.value) };
                        setUserPlanning(newPlanning);
                        setDoc(doc(db, 'userPlanning', userId), newPlanning);
                      }}
                    >
                      {[1,2,3,4,5,6,7].map(d => <option key={d} value={d}>{d} jours / semaine</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 border-b pb-2">Calcul de l'effort</h3>
                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <p className="text-indigo-900 font-bold text-xl">Objectif quotidien</p>
                    <p className="text-indigo-600 font-medium">Basé sur votre date d'examen et les questions restantes.</p>
                  </div>
                  <div className="text-center md:text-right">
                    <p className="text-5xl font-black text-indigo-600 leading-none">{userPlanning?.dailyTarget || 40}</p>
                    <p className="text-sm font-bold text-indigo-400 uppercase tracking-widest mt-1">Questions / Jour</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
              <h3 className="text-lg font-bold text-gray-900">Progression du jour</h3>
              <div className="flex flex-col items-center justify-center py-4">
                <div className="relative w-40 h-40">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="80" cy="80" r="70" className="stroke-gray-100" strokeWidth="12" fill="none" />
                    <circle 
                      cx="80" cy="80" r="70" 
                      className="stroke-indigo-500 transition-all duration-1000" 
                      strokeWidth="12" fill="none" 
                      strokeDasharray={439.8} 
                      strokeDashoffset={439.8 - (439.8 * Math.min((dailyProgress?.done || 0) / (userPlanning?.dailyTarget || 40), 1))} 
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-black text-gray-900">{dailyProgress?.done || 0}</span>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">/ {userPlanning?.dailyTarget || 40}</span>
                  </div>
                </div>
                <p className="mt-6 text-sm font-medium text-gray-500 text-center">
                  {dailyProgress?.done >= (userPlanning?.dailyTarget || 40) 
                    ? "Objectif atteint ! Félicitations ! 🎉" 
                    : `Encore ${Math.max((userPlanning?.dailyTarget || 40) - (dailyProgress?.done || 0), 0)} questions pour aujourd'hui.`}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (isPlanSession && userId && activePlan && questions.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      safeLocalStorage.setItem(`plan_session_${userId}`, JSON.stringify({
        planId: activePlan.id,
        date: today,
        questions,
        currentIdx,
        userAnswers,
        validated
      }));
    }
  }, [isPlanSession, userId, activePlan, questions, currentIdx, userAnswers, validated]);

  const handleStartPlanSession = async () => {
    if (!activePlan || !userId) return;
    
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const savedStr = safeLocalStorage.getItem(`plan_session_${userId}`);
      if (savedStr) {
        try {
          const parsed = JSON.parse(savedStr);
          if (parsed.planId === activePlan.id && parsed.date === today && parsed.questions && parsed.questions.length > 0) {
            setQuestions(parsed.questions);
            setCurrentIdx(parsed.currentIdx || 0);
            setUserAnswers(parsed.userAnswers || {});
            setValidated(parsed.validated || {});
            setIsPlanSession(true);
            setView('training');
            setLoading(false);
            return;
          } else {
            safeLocalStorage.removeItem(`plan_session_${userId}`);
          }
        } catch (e) {
          console.error("Error parsing saved session", e);
          safeLocalStorage.removeItem(`plan_session_${userId}`);
        }
      }

      let allQuestions: any[] = [];
      const blockIds = activePlan.blocks;
      for (let i = 0; i < blockIds.length; i += 10) {
        const chunk = blockIds.slice(i, i + 10);
        const q = query(collection(db, 'questions'), where('blockId', 'in', chunk));
        const snap = await getDocs(q);
        allQuestions = [...allQuestions, ...snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))];
      }
      
      allQuestions.sort(() => Math.random() - 0.5);
      
      const doneToday = activePlan.progress?.[today] || 0;
      
      let backlog = 0;
      const planStartDate = new Date(activePlan.startDate);
      let checkDate = new Date(activePlan.startDate);
      const todayDate = new Date(today);
      while (checkDate < todayDate) {
        const dateStr = checkDate.toISOString().split('T')[0];
        const doneOnDate = activePlan.progress?.[dateStr] || 0;
        if (doneOnDate < activePlan.dailyTarget) {
          backlog += (activePlan.dailyTarget - doneOnDate);
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }

      // Fetch answers for all questions first to ensure we only load valid ones
      const allQuestionIds = allQuestions.map(q => q.id);
      let allAnswers: any[] = [];
      if (allQuestionIds.length > 0) {
        for (let i = 0; i < allQuestionIds.length; i += 30) {
          const chunk = allQuestionIds.slice(i, i + 30);
          const aQuery = query(collection(db, 'answers'), where('questionId', 'in', chunk));
          const answersSnap = await getDocs(aQuery);
          allAnswers = [...allAnswers, ...answersSnap.docs.map(doc => doc.data())];
        }
      }

      // Filter out questions that do not have matching answers in the database
      let validQuestions = allQuestions.filter(q => allAnswers.some(a => a.questionId === q.id));

      if (validQuestions.length === 0 && allQuestions.length > 0) {
        console.warn("Aucune réponse correspondante trouvée, utilisation de toutes les questions.");
        validQuestions = allQuestions;
      }
      
      const currentTarget = activePlan.dailyTarget + backlog;
      const remainingForToday = Math.max(0, currentTarget - doneToday);
      
      if (remainingForToday === 0) {
        setLoading(false);
        return;
      }
      
      const sessionQuestions = validQuestions.slice(0, remainingForToday);

      const mergedQuestions = sessionQuestions.map(q => buildQuestionWithImages(q, allAnswers.find(a => a.questionId === q.id)));
      
      setQuestions(mergedQuestions);
      setCurrentIdx(0);
      setUserAnswers({});
      setValidated({});
      setIsPlanSession(true);
      setView('training');
    } catch (e) {
      console.error("Error starting plan session", e);
    } finally {
      setLoading(false);
    }
  };

  const renderDailyObjectiveCard = () => {
    if (!activePlan) return null;

    const today = new Date().toISOString().split('T')[0];
    const doneToday = activePlan.progress?.[today] || 0;
    
    let backlog = 0;
    const planStartDate = new Date(activePlan.startDate);
    let checkDate = new Date(activePlan.startDate);
    const todayDate = new Date(today);
    while (checkDate < todayDate) {
      const dateStr = checkDate.toISOString().split('T')[0];
      const doneOnDate = activePlan.progress?.[dateStr] || 0;
      if (doneOnDate < activePlan.dailyTarget) {
        backlog += (activePlan.dailyTarget - doneOnDate);
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }

    const currentTarget = activePlan.dailyTarget + backlog;
    const isCompleted = doneToday >= currentTarget;

    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-indigo-600 to-blue-700 p-8 rounded-[3rem] text-white shadow-2xl shadow-indigo-200 relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-4 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 rounded-full backdrop-blur-md border border-white/20">
              <Target className="w-5 h-5" />
              <span className="font-black text-sm uppercase tracking-widest">Objectif du jour</span>
            </div>
            <h3 className="text-4xl md:text-5xl font-black tracking-tight">
              {doneToday} / {currentTarget} <span className="text-2xl opacity-60">QCM</span>
            </h3>
            {backlog > 0 && (
              <p className="flex items-center gap-2 text-amber-300 font-bold bg-amber-900/20 px-4 py-2 rounded-2xl border border-amber-500/30 w-fit mx-auto md:mx-0">
                <AlertTriangle className="w-5 h-5" />
                {backlog} QCM en retard
              </p>
            )}
          </div>

          <div className="flex flex-col items-center gap-4">
            {isCompleted ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-20 h-20 bg-green-400 rounded-full flex items-center justify-center shadow-lg shadow-green-900/20">
                  <CheckCircle2 className="w-12 h-12 text-white" />
                </div>
                <p className="font-black text-xl">Objectif atteint ! 🎉</p>
              </div>
            ) : (
              <button 
                onClick={handleStartPlanSession}
                className="bg-white text-indigo-600 px-10 py-5 rounded-[2rem] font-black text-xl hover:bg-indigo-50 transition-all shadow-xl hover:scale-105 active:scale-95 flex items-center gap-3"
              >
                <Play className="w-6 h-6 fill-current" />
                Commencer ma session
              </button>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  const renderDashboard = () => {
    const modules = [
      {
        id: 'books',
        title: 'Entraînement',
        description: 'Révisez par livre, chapitre et bloc de questions.',
        icon: <Book className="w-8 h-8 text-indigo-600" />,
        color: 'bg-indigo-50',
        borderColor: 'border-indigo-100',
        hoverColor: 'hover:bg-indigo-100/50'
      },
      {
        id: 'simulation',
        title: 'Simulation',
        description: 'Auto-évaluation et Examens Blancs.',
        icon: <Target className="w-8 h-8 text-amber-600" />,
        color: 'bg-amber-50',
        borderColor: 'border-amber-100',
        hoverColor: 'hover:bg-amber-100/50'
      },
      {
        id: 'planning',
        title: 'Planification',
        description: 'Créez un programme de révision personnalisé.',
        icon: <Calendar className="w-8 h-8 text-emerald-600" />,
        color: 'bg-emerald-50',
        borderColor: 'border-emerald-100',
        hoverColor: 'hover:bg-emerald-100/50'
      },
      {
        id: 'progression',
        title: 'Progression',
        description: 'Suivez votre objectif quotidien et vos statistiques.',
        icon: <TrendingUp className="w-8 h-8 text-blue-600" />,
        color: 'bg-blue-50',
        borderColor: 'border-blue-100',
        hoverColor: 'hover:bg-blue-100/50'
      },
      {
        id: 'revision',
        title: 'Révision',
        description: 'Consultez fiches et vidéos de cours.',
        icon: <FileText className="w-8 h-8 text-purple-600" />,
        color: 'bg-purple-50',
        borderColor: 'border-purple-100',
        hoverColor: 'hover:bg-purple-100/50'
      },
      {
        id: 'errors',
        title: 'Mes erreurs',
        description: `Révisez vos ${userErrors.length} erreur${userErrors.length > 1 ? 's' : ''} enregistrée${userErrors.length > 1 ? 's' : ''}.`,
        icon: <XCircle className="w-8 h-8 text-red-600" />,
        color: 'bg-red-50',
        borderColor: 'border-red-100',
        hoverColor: 'hover:bg-red-100/50'
      }
    ];

    if (isAdmin) {
      modules.push({
        id: 'admin',
        title: 'Administration',
        description: 'Gérez les questions, les livres et les utilisateurs.',
        icon: <Settings className="w-8 h-8 text-rose-600" />,
        color: 'bg-rose-50',
        borderColor: 'border-rose-100',
        hoverColor: 'hover:bg-rose-100/50'
      });
    }

    if (user?.role === 'partner' || user?.role === 'apporteur') {
      modules.push({
        id: 'partner_space',
        title: user?.role === 'apporteur' ? 'Mon Espace Apporteur' : 'Mon Espace Partenaire',
        description: user?.role === 'apporteur'
          ? 'Retournez au suivi de vos parrainages, statistiques et de vos finances.'
          : 'Retournez au suivi de vos affiliés, statistiques et de vos finances.',
        icon: <Award className="w-8 h-8 text-indigo-600 animate-pulse" />,
        color: 'bg-indigo-50/80',
        borderColor: 'border-indigo-200',
        hoverColor: 'hover:bg-indigo-100/70'
      });
    }

    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative pt-2">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
          <div>
            {(user?.role === 'partner' || user?.role === 'apporteur') && onSwitchToPartnerSpace && (
              <button
                onClick={onSwitchToPartnerSpace}
                className="flex items-center gap-2 px-5 py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-750 border border-indigo-200 rounded-2xl transition-all font-black text-xs shadow-sm active:scale-95"
              >
                <Award className="w-4 h-4 text-indigo-600 animate-pulse" />
                <span>{user?.role === 'apporteur' ? 'Retourner à mes Statistiques' : 'Retourner à mon Espace Partenaire'}</span>
              </button>
            )}
          </div>
          <GamificationHeader userProgress={userProgress} plans={plans} lastExamRank={userLastExamRank} onRestartTutorial={handleRestartTutorial} isDemo={isDemo} onLogout={onLogout} />
        </div>
        <header className="text-center space-y-4 pt-4 md:pt-4">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-24 h-24 mx-auto mb-4 relative"
          >
            <img 
              src="/logo.jpg" 
              alt="Smart Tutor Logo" 
              className="w-full h-full object-contain filter drop-shadow-[0_8px_16px_rgba(165,180,252,0.15)] rounded-2xl"
              referrerPolicy="no-referrer"
            />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-3xl md:text-6xl font-display font-black tracking-tight"
          >
            <span className="bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-transparent">Smart Tutor</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-gray-500 max-w-2xl mx-auto px-4"
          >
            Bienvenue sur votre espace d'apprentissage. Choisissez un module pour commencer.
          </motion.p>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 px-2 md:px-0">
          {modules.map((mod, idx) => (
            <motion.button
              key={mod.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 * idx }}
              onClick={() => {
                if (mod.id === 'admin') {
                  navigate('/admin');
                } else if (mod.id === 'partner_space') {
                  if (onSwitchToPartnerSpace) {
                    onSwitchToPartnerSpace();
                  }
                } else {
                  setIsPlanSession(false);
                  setIsErrorSession(false);
                  setView(mod.id as ViewState);
                }
              }}
              id={`module-${mod.id}`}
              className={cn(
                "group relative flex flex-col items-center text-center p-4 md:p-8 rounded-3xl md:rounded-[2.5rem] border-2 transition-all duration-300",
                mod.color,
                mod.borderColor,
                mod.hoverColor,
                "hover:shadow-xl hover:-translate-y-2",
                isDemo && mod.id === 'simulation' && "opacity-90"
              )}
            >
              {isDemo && mod.id === 'simulation' && (
                <div className="absolute top-2 right-2 md:top-4 md:right-4 bg-amber-100 text-amber-700 px-2 py-0.5 md:py-1 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-wider flex items-center gap-1 z-10">
                  <Lock className="w-2.5 h-2.5 md:w-3 h-3" /> Premium
                </div>
              )}
              <div className="p-3 md:p-5 bg-white rounded-2xl md:rounded-3xl shadow-sm mb-3 md:mb-6 group-hover:scale-110 transition-transform duration-300">
                {mod.icon}
              </div>
              <h3 className="text-lg md:text-2xl font-bold text-gray-900 mb-1 md:mb-2">{mod.title}</h3>
              <p className="text-gray-500 text-xs md:text-sm leading-relaxed hidden md:block">{mod.description}</p>
              
              <div className="mt-4 md:mt-8 p-2 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-sm hidden md:block">
                <ArrowRight className="w-5 h-5 text-gray-400" />
              </div>
            </motion.button>
          ))}
        </div>

        {activePlan && renderDailyObjectiveCard()}

        {/* Gamification Summary */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white p-8 rounded-[3rem] border border-gray-100 shadow-xl shadow-gray-100/50 flex flex-col md:flex-row items-center justify-center gap-8"
        >
          <div className="flex items-center gap-4">
            {userProgress && (
              <>
                <div className="flex flex-col items-center px-6 py-3 bg-orange-50 rounded-3xl border border-orange-100">
                  <div className="flex items-center gap-2 text-orange-600 mb-1">
                    <Flame className="w-5 h-5 fill-current" />
                    <span className="text-2xl font-black">{userProgress.currentStreak}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-orange-400">Série</span>
                </div>
                
                <div className="flex flex-col items-center px-6 py-3 bg-emerald-50 rounded-3xl border border-emerald-100">
                  <div className="flex items-center gap-2 text-emerald-600 mb-1">
                    <Target className="w-5 h-5" />
                    <span className="text-2xl font-black">{Number(((userProgress.accuracy || 0) * 100).toFixed(2))}%</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Précision</span>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    );
  };

  const handleCancelPlan = async () => {
    if (!activePlan) return;
    askConfirmation(
      "Annuler le programme",
      "Êtes-vous sûr de vouloir annuler votre programme d'étude actuel ? Votre progression sera conservée mais le plan ne sera plus actif.",
      async () => {
        try {
          setLoading(true);
          await updateDoc(doc(db, 'studyPlans', activePlan.id), { status: 'cancelled' });
          setActivePlan(null);
        } catch (e) {
          console.error("Error cancelling plan", e);
        } finally {
          setLoading(false);
        }
      }
    );
  };

  const handleStartErrorSession = async () => {
    if (userErrors.length === 0) return;
    
    try {
      setLoading(true);
      
      const fetchedQuestions: any[] = [];
      const chunkSize = 30;
      const questionIds = userErrors.map(e => e.questionId);
      
      for (let i = 0; i < questionIds.length; i += chunkSize) {
        const chunk = questionIds.slice(i, i + chunkSize);
        for (const id of chunk) {
          const docSnap = await getDoc(doc(db, 'questions', id));
          if (docSnap.exists()) {
            fetchedQuestions.push({ id: docSnap.id, ...docSnap.data() });
          }
        }
      }
      
      if (fetchedQuestions.length === 0) {
        setError("Aucune question trouvée.");
        return;
      }

      // Fetch answers
      const answersMap: Record<string, any> = {};
      
      for (let i = 0; i < questionIds.length; i += chunkSize) {
        const chunk = questionIds.slice(i, i + chunkSize);
        const answersSnap = await getDocs(query(collection(db, 'answers'), where('questionId', 'in', chunk)));
        answersSnap.forEach(d => {
          const data = d.data();
          answersMap[data.questionId] = data;
        });
      }

      const questionsWithAnswers = fetchedQuestions.map(q => buildQuestionWithImages(q, answersMap[q.id]));

      setQuestions(questionsWithAnswers);
      setCurrentIdx(0);
      setUserAnswers({});
      setValidated({});
      setIsPlanSession(false);
      setIsErrorSession(true);
      setView('training');
    } catch (e) {
      console.error("Error starting error session", e);
    } finally {
      setLoading(false);
    }
  };

  const formatCountdown = (targetDate: Date) => {
    const diff = targetDate.getTime() - currentTime.getTime();
    if (diff <= 0) return "00:00:00";
    
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleStartDailySession = async (day: any) => {
    if (!day || day.blocks.length === 0) return;
    
    try {
      setLoading(true);
      
      const fetchedQuestions: any[] = [];
      const chunkSize = 30;
      for (let i = 0; i < day.blocks.length; i += chunkSize) {
        const chunk = day.blocks.slice(i, i + chunkSize);
        const q = query(collection(db, 'questions'), where('blockId', 'in', chunk));
        const snap = await getDocs(q);
        snap.docs.forEach(d => fetchedQuestions.push({ id: d.id, ...d.data() }));
      }
      
      if (fetchedQuestions.length === 0) {
        setError("Aucune question trouvée pour ce jour.");
        return;
      }

      // Fetch answers
      const questionIds = fetchedQuestions.map(q => q.id);
      const answersMap: Record<string, any> = {};
      
      for (let i = 0; i < questionIds.length; i += chunkSize) {
        const chunk = questionIds.slice(i, i + chunkSize);
        const answersSnap = await getDocs(query(collection(db, 'answers'), where('questionId', 'in', chunk)));
        answersSnap.forEach(d => {
          const data = d.data();
          answersMap[data.questionId] = data;
        });
      }

      // Filter out questions that do not have associated answers in the database
      let questionsWithAnswers = fetchedQuestions
        .filter(q => answersMap[q.id])
        .map(q => buildQuestionWithImages(q, answersMap[q.id]));

      if (questionsWithAnswers.length === 0 && fetchedQuestions.length > 0) {
        console.warn("Aucune réponse correspondante trouvée, utilisation de toutes les questions.");
        questionsWithAnswers = fetchedQuestions.map(q => buildQuestionWithImages(q, answersMap[q.id]));
      }

      setQuestions(questionsWithAnswers);
      setCurrentIdx(0);
      setUserAnswers({});
      setValidated({});
      setIsPlanSession(true);
      setView('training');
    } catch (e) {
      console.error("Error starting daily session", e);
    } finally {
      setLoading(false);
    }
  };

  const renderSettings = () => {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </button>
            <h2 className="text-3xl font-display font-black text-gray-900 tracking-tight">Paramètres</h2>
          </div>
          <p className="text-gray-500 font-medium ml-12">Gérez vos préférences et votre profil académique.</p>
        </header>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 overflow-hidden">
          <div className="p-8 space-y-8">
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-gray-50 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Profil Académique</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 ml-1">Filière</label>
                  <select 
                    value={userFiliere}
                    onChange={async (e) => {
                      const newF = e.target.value;
                      if (!userId || isDemo) return;
                      try {
                        await updateDoc(doc(db, 'users', userId), { filiere: newF, niveau: 'ALL' });
                        onUpdateUser?.({ filiere: newF, niveau: 'ALL' });
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                    className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold"
                  >
                    {FILIERE_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 ml-1">Niveau / Année</label>
                  <select 
                    value={userNiveau}
                    onChange={async (e) => {
                      const newN = e.target.value;
                      if (!userId || isDemo) return;
                      try {
                        await updateDoc(doc(db, 'users', userId), { niveau: newN });
                        onUpdateUser?.({ niveau: newN });
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                    className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold"
                  >
                    {getLevelsForFiliere(userFiliere).map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
                  </select>
                </div>
              </div>
              
              <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start gap-4">
                <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700 font-medium leading-relaxed">
                  Changer votre filière ou votre niveau filtrera automatiquement le contenu (livres, chapitres, questions) disponible dans l'application.
                </p>
              </div>
            </section>

            <section className="space-y-6 pt-4">
              <div className="flex items-center gap-3 border-b border-gray-50 pb-4">
                <div className="p-2 bg-slate-50 rounded-lg text-slate-600">
                  <Settings className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Application</h3>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={handleRestartTutorial}
                  className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-2xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <HelpCircle className="w-5 h-5 text-gray-400 group-hover:text-indigo-600 transition-colors" />
                    <span className="font-bold text-gray-700">Revoir le guide interactif</span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300" />
                </button>

                <button 
                  onClick={onLogout}
                  className="w-full flex items-center justify-between p-4 bg-red-50 hover:bg-red-100 rounded-2xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <LogOut className="w-5 h-5 text-red-400 group-hover:text-red-600 transition-colors" />
                    <span className="font-bold text-red-600">Se déconnecter</span>
                  </div>
                  <LogOut className="w-5 h-5 text-red-300" />
                </button>
              </div>
            </section>
          </div>
          
          <div className="bg-gray-50 p-6 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Smart Tutor v2.1.0</span>
            <div className="flex gap-4">
              <span className="text-xs font-bold text-gray-400">ID: {userId || 'Demo'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const generateStudyPlan = (endDateStr: string, selectedBlocks: string[], totalQuestions: number) => {
    const endDate = new Date(endDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = endDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) {
      throw new Error("End date must be in the future");
    }

    const dailyTarget = Math.ceil(totalQuestions / diffDays);
    const days: any[] = [];
    const blocksPerDay = Math.ceil(selectedBlocks.length / diffDays);
    
    for (let i = 0; i < diffDays; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayBlocks = selectedBlocks.slice(i * blocksPerDay, (i + 1) * blocksPerDay);
      
      days.push({
        date: dateStr,
        target: dailyTarget,
        blocks: dayBlocks,
        status: "pending", 
        done: 0
      });
    }

    return { days, dailyTarget, diffDays, today };
  };

  const handleCreatePlan = async (e?: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    if (isSubmitting) return;
    
    if (!userId) {
      console.error("No user logged in");
      return;
    }
    if (!plannerConfig.endDate) {
      console.error("No end date selected");
      return;
    }
    if (plannerConfig.selectedBlocks.length === 0) {
      console.error("No blocks selected");
      return;
    }

    setIsSubmitting(true);
    
    try {
      const { days, dailyTarget, today } = generateStudyPlan(
        plannerConfig.endDate, 
        plannerConfig.selectedBlocks, 
        plannerAvailableQuestionsCount
      );

      const newPlan = {
        userId: userId,
        startDate: today.toISOString().split('T')[0],
        endDate: plannerConfig.endDate,
        createdAt: new Date().toISOString(),
        totalQuestions: plannerAvailableQuestionsCount,
        dailyTarget,
        blocks: plannerConfig.selectedBlocks,
        status: "active",
        progress: {},
        days
      };

      setLoading(true);
      const q = query(collection(db, 'studyPlans'), where('userId', '==', userId), where('status', '==', 'active'));
      const activeSnap = await getDocs(q);
      const batch = writeBatch(db);
      activeSnap.forEach(doc => {
        batch.update(doc.ref, { status: 'cancelled' });
      });
      
      const newPlanRef = doc(collection(db, 'studyPlans'));
      batch.set(newPlanRef, newPlan);
      await batch.commit();
      
      console.log("PLAN GENERATED", newPlan);

      setActivePlan({ id: newPlanRef.id, ...newPlan });

      setPlannerConfig({
        endDate: '',
        selectedBooks: [],
        selectedChapters: [],
        selectedBlocks: []
      });
      setView('progression');
    } catch (e: any) {
      console.error("Error creating plan", e);
    } finally {
      setLoading(false);
      setIsSubmitting(false);
    }
  };

  if (view === 'planning') {
    const endDate = new Date(plannerConfig.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = endDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const calculatedQuestionsPerDay = diffDays >= 0 ? Math.ceil(plannerAvailableQuestionsCount / Math.max(1, diffDays)) : 0;

    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8 relative">
        <button 
          onClick={() => setView('dashboard')} 
          className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-medium transition-all group w-fit py-2 px-1 relative z-10 cursor-pointer touch-action-manipulation"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Retour au Dashboard
        </button>

        <header className="bg-white p-8 rounded-3xl border border-indigo-100 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-bl-full -z-10 opacity-50" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2 relative z-10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 rounded-2xl">
                <Calendar className="w-8 h-8 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Planification</h2>
                <p className="text-gray-500 font-medium">Organisez votre préparation pour réussir vos examens.</p>
              </div>
            </div>
            {activePlan && (
              <button 
                onClick={handleDeletePlan} 
                disabled={loading}
                className="bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
                title="Supprimer la planification actuelle"
              >
                <Trash2 className="w-5 h-5" /> Supprimer la planification
              </button>
            )}
          </div>
        </header>

        {/* List of existing plans */}
        {plans.length > 0 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-600" /> Vos Planifications
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plans.map((plan) => (
                <div key={plan.id} className={cn(
                  "p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 group",
                  plan.status === 'active' ? "bg-indigo-50 border-indigo-200 ring-2 ring-indigo-100" : "bg-white border-gray-100 opacity-75"
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                        plan.status === 'active' ? "bg-indigo-600 text-white" : 
                        plan.status === 'expired' ? "bg-amber-100 text-amber-700" :
                        "bg-gray-200 text-gray-600"
                      )}>
                        {plan.status === 'active' ? 'Active' : plan.status === 'expired' ? 'Expirée' : 'Annulée'}
                      </span>
                      <span className="text-xs text-gray-400 font-medium">{new Date(plan.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="text-sm font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                      Jusqu'au {new Date(plan.endDate).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-gray-500 font-medium">
                      {plan.totalQuestions} questions • {plan.dailyTarget} obj/jour
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDeleteAnyPlan(plan.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                    title="Supprimer"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8">
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 border-b pb-2">Configuration de l'objectif</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Date de fin (Examen)</label>
                    <input 
                      type="date" 
                      className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={plannerConfig.endDate}
                      onChange={(e) => setPlannerConfig(prev => ({ ...prev, endDate: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Books Selection */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 border-b pb-2">1. Livres à inclure</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
                  {books.map(book => (
                    <label key={book.id} className={cn(
                      "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                      plannerConfig.selectedBooks.includes(book.id) ? "border-indigo-600 bg-indigo-50/50" : "border-gray-200 hover:border-indigo-300"
                    )}>
                      <input 
                        type="checkbox" 
                        className="mt-1 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        checked={plannerConfig.selectedBooks.includes(book.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setPlannerConfig(prev => ({ ...prev, selectedBooks: [...prev.selectedBooks, book.id] }));
                          } else {
                            setPlannerConfig(prev => ({ ...prev, selectedBooks: prev.selectedBooks.filter(id => id !== book.id) }));
                          }
                        }}
                      />
                      <div>
                        <p className="font-bold text-gray-900">{book.name}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Chapters Selection */}
              {plannerConfig.selectedBooks.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 border-b pb-2">2. Sections à inclure</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
                    {plannerAvailableChapters.map(chapter => {
                      const bookName = books.find(b => b.id === chapter.bookId)?.name || '';
                      return (
                        <label key={chapter.id} className={cn(
                          "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                          plannerConfig.selectedChapters.includes(chapter.id) ? "border-indigo-600 bg-indigo-50/50" : "border-gray-200 hover:border-indigo-300"
                        )}>
                          <input 
                            type="checkbox" 
                            className="mt-1 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                            checked={plannerConfig.selectedChapters.includes(chapter.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPlannerConfig(prev => ({ ...prev, selectedChapters: [...prev.selectedChapters, chapter.id] }));
                              } else {
                                setPlannerConfig(prev => ({ ...prev, selectedChapters: prev.selectedChapters.filter(id => id !== chapter.id) }));
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 text-sm truncate">{chapter.title}</p>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{bookName}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {plannerAvailableChapters.length > 0 && (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setPlannerConfig(prev => ({ ...prev, selectedChapters: plannerAvailableChapters.map(c => c.id) }))}
                        onTouchStart={(e) => setPlannerConfig(prev => ({ ...prev, selectedChapters: plannerAvailableChapters.map(c => c.id) }))}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors relative z-10 cursor-pointer touch-action-manipulation"
                      >
                        Tout sélectionner
                      </button>
                      <button 
                        onClick={() => setPlannerConfig(prev => ({ ...prev, selectedChapters: [] }))}
                        onTouchStart={(e) => setPlannerConfig(prev => ({ ...prev, selectedChapters: [] }))}
                        className="text-xs font-bold text-gray-600 hover:text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors relative z-10 cursor-pointer touch-action-manipulation"
                      >
                        Tout désélectionner
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Blocks Selection */}
              {plannerConfig.selectedChapters.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 border-b pb-2">3. Blocs à inclure</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
                    {plannerAvailableBlocks.map(block => {
                      const chapterTitle = plannerAvailableChapters.find(c => c.id === block.chapterId)?.title || '';
                      return (
                        <label key={block.id} className={cn(
                          "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                          plannerConfig.selectedBlocks.includes(block.id) ? "border-indigo-600 bg-indigo-50/50" : "border-gray-200 hover:border-indigo-300"
                        )}>
                          <input 
                            type="checkbox" 
                            className="mt-1 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                            checked={plannerConfig.selectedBlocks.includes(block.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPlannerConfig(prev => ({ ...prev, selectedBlocks: [...prev.selectedBlocks, block.id] }));
                              } else {
                                setPlannerConfig(prev => ({ ...prev, selectedBlocks: prev.selectedBlocks.filter(id => id !== block.id) }));
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 text-sm truncate">{block.blockTitle || "Bloc sans nom"}</p>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{chapterTitle}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {plannerAvailableBlocks.length > 0 && (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setPlannerConfig(prev => ({ ...prev, selectedBlocks: plannerAvailableBlocks.map(b => b.id) }))}
                        onTouchStart={(e) => setPlannerConfig(prev => ({ ...prev, selectedBlocks: plannerAvailableBlocks.map(b => b.id) }))}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors relative z-10 cursor-pointer touch-action-manipulation"
                      >
                        Tout sélectionner
                      </button>
                      <button 
                        onClick={() => setPlannerConfig(prev => ({ ...prev, selectedBlocks: [] }))}
                        onTouchStart={(e) => setPlannerConfig(prev => ({ ...prev, selectedBlocks: [] }))}
                        className="text-xs font-bold text-gray-600 hover:text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors relative z-10 cursor-pointer touch-action-manipulation"
                      >
                        Tout désélectionner
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 border-b pb-2">Calcul de l'effort</h3>
                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <p className="text-indigo-900 font-bold text-xl">Objectif quotidien</p>
                    <p className="text-indigo-600 font-medium">Basé sur votre date d'examen et les questions restantes.</p>
                  </div>
                  <div className="text-center md:text-right">
                    <p className="text-5xl font-black text-indigo-600 leading-none">{calculatedQuestionsPerDay}</p>
                    <p className="text-sm font-bold text-indigo-400 uppercase tracking-widest mt-1">Questions / Jour</p>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button
                  type="button"
                  className={`w-full font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 ${
                    loading || isSubmitting || !plannerConfig.endDate || plannerConfig.selectedBlocks.length === 0 || calculatedQuestionsPerDay <= 0
                      ? 'bg-gray-300 text-white cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 cursor-pointer'
                  }`}
                  disabled={loading || isSubmitting || !plannerConfig.endDate || plannerConfig.selectedBlocks.length === 0 || calculatedQuestionsPerDay <= 0}
                  onClick={handleCreatePlan}
                >
                  {loading || isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Calendar className="w-5 h-5" />}
                  Créer mon programme
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
              <h3 className="text-lg font-bold text-gray-900">Résumé</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                  <span className="text-gray-500 font-medium">Questions totales</span>
                  <span className="font-bold text-gray-900">{plannerAvailableQuestionsCount}</span>
                </div>
                <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                  <span className="text-gray-500 font-medium">Jours restants</span>
                  <span className="font-bold text-gray-900">{diffDays > 0 ? diffDays : 0}</span>
                </div>
                <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                  <span className="text-gray-500 font-medium">Blocs sélectionnés</span>
                  <span className="font-bold text-gray-900">{plannerConfig.selectedBlocks.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full flex flex-col relative overflow-hidden">
      {/* Top Bar with Logout */}
      {!isExamActive && (
        <div className="absolute top-4 right-4 z-[90] flex items-center gap-2">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="md:hidden p-3 bg-white rounded-2xl shadow-lg border border-gray-100 text-gray-600 hover:bg-gray-50 transition-all"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      )}

      <div className="flex-1 w-full overflow-y-auto h-auto max-h-[100vh] custom-scrollbar pt-2 animate-in fade-in duration-500">
        <InteractiveGuide 
          onboardingCompleted={onboardingCompleted}
          tutorialStepsCompleted={tutorialStepsCompleted}
          onCompleteOnboarding={handleCompleteOnboarding}
          onCompleteStep={handleCompleteTutorialStep}
          onSkipAll={handleSkipAllTutorial}
          currentView={view}
        />
        {isDemo && demoQuestionsCount >= DEMO_LIMITS.MAX_QUESTIONS ? (
          renderDemoEnd()
        ) : (
          <>
            {view === 'dashboard' && renderDashboard()}
            {view === 'settings' && renderSettings()}
            {view === 'simulation' && renderSimulationModeSelection()}
            {view === 'simulation_config' && renderSimulationConfig()}
            {view === 'books' && renderBooks()}
            {view === 'chapters' && renderChapters()}
            {view === 'blocks' && renderBlocks()}
            {view === 'training' && renderTraining()}
            {view === 'progression' && renderProgression()}
            {view === 'planning' && renderPlanning()}
            {view === 'revision' && renderRevision()}
            {view === 'revision_session' && renderRevisionSession()}
            {view === 'errors' && renderErrorsModeSelection()}
            {view === 'redo_missed_questions' && renderRedoMissedQuestions()}
            {view === 'exams' && (
              <UserExamList 
                filter="all"
                allowRecompose={false}
                onSelectExam={(exam, attempt) => {
                  setSelectedExam(exam);
                  setSelectedExamAttempt(attempt);
                  setExamSourceView('exams');
                  setView('exam_session');
                }} 
                onBack={() => setView('simulation')}
              />
            )}
            {view === 'retake_past_exams' && (
              <UserExamList 
                filter="finished"
                allowRecompose={true}
                onSelectExam={(exam, attempt) => {
                  setSelectedExam(exam);
                  setSelectedExamAttempt(attempt);
                  setExamSourceView('retake_past_exams');
                  setView('exam_session');
                }} 
                onBack={() => setView('errors')}
              />
            )}
            {view === 'exam_session' && selectedExam && (
              <UserExamSession 
                exam={selectedExam} 
                attempt={selectedExamAttempt} 
                onBack={() => setView(examSourceView)} 
                onEnlargeImage={setEnlargedImage}
                onShowCourseModal={(images) => {
                  setCourseImagesVisible(images);
                  setCurrentCourseIndex(0);
                  setShowCourseModal(true);
                }}
                onShowVideoModal={(url) => {
                  setCurrentVideoUrl(url);
                  setShowVideoModal(true);
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Leaderboard Modal */}
      <AnimatePresence>
        {showLeaderboardModal && lastFinishedExam && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 md:p-8 max-w-2xl w-full shadow-2xl border border-gray-100 max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-yellow-100 rounded-2xl text-yellow-600">
                    <Trophy className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Classement Complet</h2>
                    <p className="text-gray-500 font-medium">{lastFinishedExam.title}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowLeaderboardModal(false)}
                  className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {lastExamLeaderboard.length > 0 ? (
                  lastExamLeaderboard.map((entry, idx) => (
                    <div key={entry.id} className={`flex items-center justify-between p-4 rounded-xl border ${entry.userId === userId ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${idx === 0 ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-300' : idx === 1 ? 'bg-gray-200 text-gray-700 border-2 border-gray-300' : idx === 2 ? 'bg-orange-100 text-orange-700 border-2 border-orange-300' : 'bg-white text-gray-500 border border-gray-200'}`}>
                          {idx + 1}
                        </div>
                        <span className="font-bold text-gray-900 text-lg">{entry.userName}</span>
                        {entry.userId === userId && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-bold uppercase tracking-wider">Vous</span>}
                      </div>
                      <div className="text-right">
                        <div className="font-black text-gray-900 text-xl">
                          {entry.score} <span className="text-gray-500 text-sm font-bold">pts</span>
                        </div>
                        <div className="text-xs text-gray-400 font-medium">
                          {entry.totalQuestions} questions
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-gray-500 font-medium">
                    Aucun résultat pour le moment.
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Course Image (Fiche) Modal */}
      <AnimatePresence>
        {showCourseModal && courseImagesVisible.length > 0 && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-0 md:p-8 bg-black/95 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full h-full md:rounded-3xl shadow-2xl flex flex-col bg-gray-900 border border-white/10 overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 bg-gray-900/80 backdrop-blur-md border-b border-white/10 z-10 w-full absolute top-0 left-0">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📚</span>
                  <div>
                    <h3 className="font-bold text-white text-lg">Fiche de cours</h3>
                    <p className="text-gray-400 text-sm font-medium">Image {currentCourseIndex + 1} sur {courseImagesVisible.length}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={async () => {
                      try {
                        const currentImg = courseImagesVisible[currentCourseIndex];
                        await addDoc(collection(db, 'userSavedCards'), {
                          userId: userId || 'unknown',
                          imageUrl: currentImg,
                          savedAt: serverTimestamp()
                        });
                        alert("Fiche marquée comme importante !");
                      } catch (err) {
                        console.error(err);
                        alert("Erreur lors de la sauvegarde de la fiche.");
                      }
                    }}
                    className="p-2.5 bg-yellow-500/20 text-yellow-500 rounded-full hover:bg-yellow-500/30 transition-colors"
                    title="Marquer comme importante"
                  >
                    <Trophy className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setShowCourseModal(false)}
                    className="p-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Main Image View */}
              <div className="flex-1 flex items-center justify-center relative overscroll-none h-full pt-20">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentCourseIndex}
                    src={courseImagesVisible[currentCourseIndex]}
                    alt={`Fiche ${currentCourseIndex + 1}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="max-w-full max-h-[85vh] object-contain select-none px-4"
                    referrerPolicy="no-referrer"
                    onLoad={() => recordViewedMaterial('fiche')}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.2}
                    onDragEnd={(e, { offset, velocity }) => {
                      const swipe = velocity.x;
                      if (swipe < -20) {
                        setCurrentCourseIndex(c => Math.min(c + 1, courseImagesVisible.length - 1));
                      } else if (swipe > 20) {
                        setCurrentCourseIndex(c => Math.max(c - 1, 0));
                      }
                    }}
                  />
                </AnimatePresence>

                {/* Next/Prev Buttons (Desktop) */}
                {currentCourseIndex > 0 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setCurrentCourseIndex(c => c - 1); }}
                    className="absolute left-6 top-1/2 -translate-y-1/2 p-4 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all hidden md:block hover:scale-110 border border-white/10 backdrop-blur-md"
                  >
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                )}
                {currentCourseIndex < courseImagesVisible.length - 1 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setCurrentCourseIndex(c => c + 1); }}
                    className="absolute right-6 top-1/2 -translate-y-1/2 p-4 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all hidden md:block hover:scale-110 border border-white/10 backdrop-blur-md"
                  >
                    <ArrowRight className="w-6 h-6" />
                  </button>
                )}
              </div>

              {/* Pagination indicators */}
              {courseImagesVisible.length > 1 && (
                <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-3 z-10">
                  {courseImagesVisible.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentCourseIndex(idx)}
                      className={cn(
                        "transition-all duration-300 rounded-full",
                        idx === currentCourseIndex ? "w-8 h-2.5 bg-white shadow-lg shadow-white/20" : "w-2.5 h-2.5 bg-white/40 hover:bg-white/60"
                      )}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ZoomableImageModal 
        isOpen={!!enlargedImage} 
        onClose={() => setEnlargedImage(null)} 
        imageUrl={enlargedImage || ''} 
      />

      {/* Video Course Modal */}
      <AnimatePresence>
        {showVideoModal && currentVideoUrl && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-0 md:p-8 bg-black/95 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-5xl aspect-video md:rounded-3xl shadow-2xl bg-black overflow-hidden border border-white/10"
            >
              <div className="absolute top-4 right-4 z-10">
                <button 
                  onClick={() => setShowVideoModal(false)}
                  className="p-3 bg-gray-900 text-white rounded-full hover:bg-black transition-colors shadow-2xl"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {currentVideoUrl.includes('youtube.com') || currentVideoUrl.includes('youtu.be') || currentVideoUrl.includes('vimeo.com') ? (
                <iframe
                  src={getEmbedUrl(currentVideoUrl)}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Vidéo du cours"
                  onLoad={() => recordViewedMaterial('video')}
                />
              ) : (
                <video 
                  src={currentVideoUrl} 
                  controls 
                  autoPlay 
                  className="w-full h-full object-contain"
                  onPlay={() => recordViewedMaterial('video')}
                />
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mind Map Modal */}
      <AnimatePresence>
        {showMindMapModal && currentMindMapTree && (
          <div className="fixed inset-0 z-[400] flex flex-col bg-gray-50/95 backdrop-blur-md overflow-y-auto w-full pt-8 pb-12">
            <div className="w-full max-w-5xl mx-auto px-4 mt-6">
              <MindMapCard 
                tree={currentMindMapTree} 
                onBack={() => setShowMindMapModal(false)}
              />
            </div>
          </div>
        )}
      </AnimatePresence>
      <PDFModal 
        isOpen={showPdfModal} 
        onClose={() => setShowPdfModal(false)} 
        pdfUrl={currentPdfUrl} 
      />
    </div>
  );
}

function PDFModal({ isOpen, onClose, pdfUrl }: { isOpen: boolean, onClose: () => void, pdfUrl: string | null }) {
  return (
    <AnimatePresence>
      {isOpen && pdfUrl && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-0 md:p-8 bg-black/90 backdrop-blur-md" onClick={onClose}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-6xl h-full md:h-[90vh] bg-white md:rounded-3xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md z-20">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600 shadow-sm border border-indigo-100">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="flex flex-col">
                  <span className="font-display font-black text-gray-900 tracking-tight">Fiche de Cours PDF</span>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Support Pédagogique Officiel</span>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <a 
                  href={pdfUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hidden md:flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl transition-all font-bold text-sm border border-gray-200"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Ouvrir dans un nouvel onglet</span>
                </a>
                <button 
                  onClick={onClose} 
                  className="p-3 bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-2xl transition-all border border-gray-100 group"
                >
                  <X className="w-6 h-6 group-hover:scale-110 transition-transform" />
                </button>
              </div>
            </div>

            {/* PDF Viewer Content */}
            <div className="flex-1 bg-gray-50 relative">
              <iframe 
                src={`${pdfUrl}#view=FitH`} 
                className="w-full h-full border-none"
                title="PDF Viewer"
              />
              
              {/* Fallback for mobile or small screens */}
              <div className="absolute inset-0 flex items-center justify-center p-8 text-center bg-gray-50 z-[-1]">
                <div className="space-y-4 max-w-sm">
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                    <FileText className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h3 className="font-bold text-gray-900">Le PDF est prêt</h3>
                  <p className="text-sm text-gray-500">Si le lecteur ne s'affiche pas, vous pouvez ouvrir le fichier directement.</p>
                  <a 
                    href={pdfUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200"
                  >
                    <Download className="w-5 h-5" /> Télécharger / Lire
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function getEmbedUrl(url: string) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const videoId = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
    return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
  }
  if (url.includes('vimeo.com')) {
    const videoId = url.split('/').pop();
    return `https://player.vimeo.com/video/${videoId}?autoplay=1`;
  }
  return url;
}

function ZoomableImageModal({ isOpen, onClose, imageUrl }: { isOpen: boolean, onClose: () => void, imageUrl: string }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen]);

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(prev => Math.min(prev + 0.25, 4));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      const clientX = 'touches' in e ? (e as any).touches?.[0]?.clientX : (e as any).clientX;
      const clientY = 'touches' in e ? (e as any).touches?.[0]?.clientY : (e as any).clientY;
      setDragStart({ x: clientX - position.x, y: clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isDragging && scale > 1) {
      const clientX = 'touches' in e ? (e as any).touches?.[0]?.clientX : (e as any).clientX;
      const clientY = 'touches' in e ? (e as any).touches?.[0]?.clientY : (e as any).clientY;
      setPosition({
        x: clientX - dragStart.x,
        y: clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          onClick={onClose}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          onTouchCancel={handleMouseUp}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative w-full h-full flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Controls */}
            <div className="absolute top-6 right-6 flex items-center gap-3 z-10">
              <div className="flex items-center gap-1 bg-white/10 backdrop-blur-md p-1.5 rounded-2xl border border-white/20 shadow-2xl">
                <button 
                  onClick={handleZoomOut}
                  className="p-2.5 text-white hover:bg-white/20 rounded-xl transition-colors"
                  title="Zoom arrière"
                >
                  <ZoomOut className="w-5 h-5" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <span className="text-white text-xs font-bold w-12 text-center">
                  {Math.round(scale * 100)}%
                </span>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button 
                  onClick={handleZoomIn}
                  className="p-2.5 text-white hover:bg-white/20 rounded-xl transition-colors"
                  title="Zoom avant"
                >
                  <ZoomIn className="w-5 h-5" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button 
                  onClick={handleReset}
                  className="p-2.5 text-white hover:bg-white/20 rounded-xl transition-colors"
                  title="Réinitialiser"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>
              
              <button 
                onClick={onClose}
                className="p-3 bg-white/10 backdrop-blur-md text-white hover:bg-red-500 rounded-2xl border border-white/20 transition-all shadow-2xl group"
              >
                <X className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </button>
            </div>

            {/* Image Container */}
            <div 
              className={cn(
                "relative transition-transform duration-75 ease-out cursor-grab active:cursor-grabbing",
                isDragging && "scale-[1.01]"
              )}
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              }}
              onMouseDown={handleMouseDown}
              onTouchStart={handleMouseDown}
            >
              <img 
                src={imageUrl} 
                alt="Enlarged view" 
                className="max-w-[90vw] max-h-[85vh] rounded-xl shadow-2xl pointer-events-none select-none border border-white/10"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Hint */}
            {scale > 1 && (
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur-sm text-white/70 text-xs px-4 py-2 rounded-full border border-white/10">
                Maintenez le clic pour déplacer l'image
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
