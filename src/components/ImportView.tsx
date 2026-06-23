import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Eye, FileUp, Image as ImageIcon, Plus, Loader2, Trash2, PlayCircle, GitBranch, BookOpen, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseLangeQuestions, parseLangeAnswers, parsePreTestQuestions, parsePreTestAnswers, parseMinsanteQuestions, parseMinsanteAnswers, ParsedQuestion, ParsedAnswer, normalizeParsedData } from '../lib/parser';
import { db, storage, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, query, where, getDocs, serverTimestamp, doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { generateMindMap, generateQuestionsWithAI, segmentTextIntoQuestions, processQuestionsBatch, analyzeTableImageWithAI, TableData } from '../services/geminiService';

import { FILIERES, FILIERE_OPTIONS, getLevelsForFiliere } from '../lib/constants';

interface ImageAssociation {
  file: File;
  preview: string;
  type: 'question' | 'correction' | 'fiche' | 'video';
  targetNumber: number;
  caption: string;
}

const compressImage = (file: File, maxWidth = 1024, maxHeight = 1024, quality = 0.7): Promise<File> => {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

const fileToBase64 = async (file: File): Promise<string> => {
  let fileToConvert = file;
  if (file.type.startsWith('image/')) {
    try {
      fileToConvert = await compressImage(file, 1024, 1024, 0.7);
    } catch (err) {
      console.warn("Failed to compress image for base64:", err);
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(fileToConvert);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

const uploadFileWithFallback = async (file: File, path: string): Promise<string> => {
  let fileToUpload = file;
  if (file.type.startsWith('image/')) {
    try {
      fileToUpload = await compressImage(file, 1024, 1024, 0.7);
    } catch (compressErr) {
      console.warn("Failed to compress image before upload:", compressErr);
    }
  }

  try {
    const sRef = ref(storage, path);
    await uploadBytes(sRef, fileToUpload);
    return await getDownloadURL(sRef);
  } catch (err: any) {
    console.warn(`Firebase Storage upload failed for ${fileToUpload.name}, trying inline base64 fallback:`, err);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(fileToUpload);
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => reject(new Error("Failed to convert file to base64"));
    });
  }
};

const getChapterOptions = (docType: string) => {
  const baseOptions = ["chirurgie", "pédiatrie", "gynécologie-obstétrique", "médecine interne", "santé publique"];
  if (docType === "Ancien sujet") {
    return [...baseOptions, "médecine bucco-dentaire", "pharmacie"];
  }
  return baseOptions;
};

const booksConfig: Record<string, { type: string, parser: 'lange' | 'pretest' | 'minsante' }> = {
  "Lange": {
    type: "lange",
    parser: "lange"
  },
  "PreTest": {
    type: "pretest",
    parser: "pretest"
  },
  "EM5": {
    type: "pretest",
    parser: "pretest"
  },
  "Diagest": {
    type: "pretest",
    parser: "pretest"
  },
  "BANQUE de sujets": {
    type: "pretest",
    parser: "pretest"
  },
  "Ancien sujet": {
    type: "pretest",
    parser: "pretest"
  },
  "SEMESTRE I": {
    type: "pretest",
    parser: "pretest"
  },
  "SEMESTRE II": {
    type: "pretest",
    parser: "pretest"
  },
  "MINSANTE": {
    type: "minsante",
    parser: "minsante"
  }
};

const ImportView = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [docType, setDocType] = useState('Lange');
  const [chapterTitle, setChapterTitle] = useState('chirurgie');
  const [dbFilieres, setDbFilieres] = useState<any[]>([]);
  const [filiereSelected, setFiliereSelected] = useState('ECN');
  const [niveauSelected, setNiveauSelected] = useState('ALL');
  const [allChapters, setAllChapters] = useState<any[]>([]);
  const [allBooks, setAllBooks] = useState<any[]>([]);

  // Real-time listener on books & chapters to merge custom created ones
  useEffect(() => {
    const unsubBooks = onSnapshot(collection(db, 'books'), (snap) => {
      setAllBooks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("Error fetching books in ImportView:", err);
    });
    const unsubChapters = onSnapshot(collection(db, 'chapters'), (snap) => {
      setAllChapters(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("Error fetching chapters in ImportView:", err);
    });
    return () => {
      unsubBooks();
      unsubChapters();
    };
  }, []);

  const getCombinedChapters = () => {
    const base = getChapterOptions(docType);
    
    // Find matching book in database
    const activeBook = allBooks.find(b => 
      b.name === docType && 
      b.filiere === filiereSelected && 
      (b.niveau === niveauSelected || b.niveau === 'ALL')
    );
    
    // Include all database chapters that either match activeBook ID, or have NO book link (independent chapters)
    const dbTitles = allChapters
      .filter(c => (activeBook && c.bookId === activeBook.id) || !c.bookId)
      .map(c => c.title);
      
    // Combine and deduplicate
    const combined = [...base];
    dbTitles.forEach(t => {
      if (t && !combined.some(existing => existing.toLowerCase() === t.toLowerCase())) {
        combined.push(t);
      }
    });
    
    return combined;
  };

  // Real-time listener on filieres collection to support dynamic filieres
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'filieres'), (snap) => {
      const list = snap.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.id,
        levels: doc.data().levels || ['ALL'],
        status: doc.data().status || 'active'
      }));
      setDbFilieres(list);
    }, (err) => {
      console.error("Error fetching filieres: ", err);
    });
    return () => unsub();
  }, []);

  const getFiliereOptions = () => {
    const activeDb = dbFilieres.filter(f => f.status !== 'inactive');
    if (activeDb.length > 0) {
      return activeDb;
    }
    return FILIERE_OPTIONS.map(opt => {
      const parent = FILIERES.find(x => x.id === opt.id);
      return {
        id: opt.id,
        name: opt.name,
        levels: parent ? parent.levels : ['ALL']
      };
    });
  };

  const getLevelsForFiliereDynamic = (filId: string) => {
    const found = dbFilieres.find(f => f.id === filId);
    if (found) {
      return found.levels;
    }
    return getLevelsForFiliere(filId);
  };

  useEffect(() => {
    const options = getFiliereOptions();
    if (options.length > 0) {
      const exists = options.some(opt => opt.id === filiereSelected);
      if (!exists) {
        setFiliereSelected(options[0].id);
        setNiveauSelected('ALL');
      }
    }
  }, [dbFilieres]);

  const [blockTitle, setBlockTitle] = useState('');
  const [mindMapText, setMindMapText] = useState('');
  const [summaryImage, setSummaryImage] = useState<File | null>(null);
  const [summaryImagePreview, setSummaryImagePreview] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [questionsText, setQuestionsText] = useState('');
  const [answersText, setAnswersText] = useState('');
  const [questionImportMethod, setQuestionImportMethod] = useState<'manuel' | 'ia'>('manuel');
  const [aiQuestionsText, setAiQuestionsText] = useState('');
  
  interface AIPipelineState {
    status: 'idle' | 'segmenting' | 'segmented_wait_validation' | 'processing' | 'paused' | 'done';
    detectedQuestions: string[];
    processedQuestions: ParsedQuestion[];
    processedAnswers: ParsedAnswer[];
    currentBatchIndex: number;
    batchSize: number;
    error?: string;
  }

  const [aiState, setAiState] = useState<AIPipelineState>({
    status: 'idle',
    detectedQuestions: [],
    processedQuestions: [],
    processedAnswers: [],
    currentBatchIndex: 0,
    batchSize: 10,
  });

  const AIPipelineStorageKey = 'ai_import_pipeline_state_v1';

  useEffect(() => {
    const saved = localStorage.getItem(AIPipelineStorageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.status === 'processing' || parsed.status === 'segmenting') {
           parsed.status = 'paused'; 
        }
        setAiState(parsed);
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (aiState.status !== 'idle' && aiState.status !== 'done') {
      localStorage.setItem(AIPipelineStorageKey, JSON.stringify(aiState));
    } else if (aiState.status === 'done' || aiState.status === 'idle') {
      localStorage.removeItem(AIPipelineStorageKey);
    }
  }, [aiState]);

  const [parsedData, setParsedData] = useState<{ questions: ParsedQuestion[], answers: ParsedAnswer[] } | null>(null);
  const [imageAssociations, setImageAssociations] = useState<ImageAssociation[]>([]);
  const [isGeneratingMindMap, setIsGeneratingMindMap] = useState(false);
  const [extractedTables, setExtractedTables] = useState<Record<number, TableData>>({});
  const [analyzingTableNum, setAnalyzingTableNum] = useState<number | null>(null);
  
  const [chapterSearch, setChapterSearch] = useState('');
  const [chapterSearchSupport, setChapterSearchSupport] = useState('');

  // PDF Fiche, Image & Video Import State
  const [importMode, setImportMode] = useState<'questions' | 'pdf_fiche' | 'image_fiche' | 'video_support' | 'course_import'>('questions');
  const [availableBlocks, setAvailableBlocks] = useState<any[]>([]);
  const [selectedBlockForSupport, setSelectedBlockForSupport] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isFetchingBlocks, setIsFetchingBlocks] = useState(false);
  const [isUploadingSupport, setIsUploadingSupport] = useState(false);

  useEffect(() => {
    const options = getCombinedChapters();
    if (options.length > 0 && !options.includes(chapterTitle)) {
      setChapterTitle(options[0]);
    }
  }, [docType, filiereSelected, niveauSelected, allBooks, allChapters]);

  // Course Import State
  const [docTypeCourse, setDocTypeCourse] = useState('Série Q');
  const [chapterCourse, setChapterCourse] = useState('Q001');
  const [blockTitleCourse, setBlockTitleCourse] = useState('');
  const [videoFileCourse, setVideoFileCourse] = useState<File | null>(null);
  const [imgFileCourse, setImgFileCourse] = useState<File | null>(null);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [notifyUsers, setNotifyUsers] = useState(true);
  
  const questionsFileRef = useRef<HTMLInputElement>(null);
  const answersFileRef = useRef<HTMLInputElement>(null);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>, type: 'questions' | 'answers') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (type === 'questions') setQuestionsText(text);
      else setAnswersText(text);
    };
    reader.readAsText(file);
  };

  const handleFetchBlocks = async () => {
    setIsFetchingBlocks(true);
    setStatus(null);
    try {
      // 1. Find the Book ID first
      const booksRef = collection(db, 'books');
      const bookQuery = query(
        booksRef, 
        where('name', '==', docType),
        where('filiere', '==', filiereSelected),
        where('niveau', '==', niveauSelected)
      );
      const bookSnap = await getDocs(bookQuery);
      
      if (bookSnap.empty) {
        setAvailableBlocks([]);
        setStatus({ type: 'error', message: "Aucun livre trouvé pour cette sélection." });
        return;
      }
      
      const bookId = bookSnap.docs[0].id;

      // 2. Find the Chapter ID within that Book
      const chaptersRef = collection(db, 'chapters');
      const chapterQuery = query(
        chaptersRef, 
        where('bookId', '==', bookId), 
        where('title', '==', chapterTitle)
      );
      const chapterSnap = await getDocs(chapterQuery);

      if (chapterSnap.empty) {
        setAvailableBlocks([]);
        setStatus({ type: 'error', message: "Aucun chapitre trouvé pour cette sélection." });
        return;
      }

      const chapterId = chapterSnap.docs[0].id;

      // 3. Finally find blocks for this chapter
      const q = query(
        collection(db, 'blocks'),
        where('chapterId', '==', chapterId)
      );
      
      const querySnapshot = await getDocs(q);
      const blocks = querySnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data(),
        title: (doc.data() as any).blockTitle || "Sans titre" // Map blockTitle to title for the select component
      }));
      
      setAvailableBlocks(blocks);
      if (blocks.length === 0) {
        setStatus({ type: 'error', message: "Aucun bloc trouvé pour ce chapitre." });
      }
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de la récupération des blocs : " + err.message });
    } finally {
      setIsFetchingBlocks(false);
    }
  };

  const handleUploadPDF = async () => {
    if (!selectedBlockForSupport || !pdfFile) {
      setStatus({ type: 'error', message: "Veuillez sélectionner un bloc et un fichier PDF." });
      return;
    }

    setIsUploadingSupport(true);
    setStatus(null);
    try {
      const path = `block_fiches/${selectedBlockForSupport}_${Date.now()}.pdf`;
      const fichePdfUrl = await uploadFileWithFallback(pdfFile, path);

      await updateDoc(doc(db, 'blocks', selectedBlockForSupport), {
        fichePdfUrl,
        updatedAt: serverTimestamp()
      });

      setStatus({ type: 'success', message: "La fiche PDF a été associée au bloc avec succès !" });
      setPdfFile(null);
      setSelectedBlockForSupport('');
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de l'upload du PDF : " + err.message });
    } finally {
      setIsUploadingSupport(false);
    }
  };

  const handleUploadImage = async () => {
    if (!selectedBlockForSupport || !imageFile) {
      setStatus({ type: 'error', message: "Veuillez sélectionner un bloc et une image." });
      return;
    }

    setIsUploadingSupport(true);
    setStatus(null);
    try {
      const path = `block_fiches/${selectedBlockForSupport}_${Date.now()}_${imageFile.name}`;
      const ficheImageUrl = await uploadFileWithFallback(imageFile, path);

      await updateDoc(doc(db, 'blocks', selectedBlockForSupport), {
        ficheImageUrl,
        updatedAt: serverTimestamp()
      });

      setStatus({ type: 'success', message: "L'image a été associée au bloc avec succès !" });
      setImageFile(null);
      setSelectedBlockForSupport('');
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de l'upload de l'image : " + err.message });
    } finally {
      setIsUploadingSupport(false);
    }
  };

  const handleUpdateVideo = async () => {
    if (!selectedBlockForSupport || !videoUrl) {
      setStatus({ type: 'error', message: "Veuillez sélectionner un bloc et saisir une URL vidéo." });
      return;
    }

    setIsUploadingSupport(true);
    setStatus(null);
    try {
      await updateDoc(doc(db, 'blocks', selectedBlockForSupport), {
        videoUrl,
        updatedAt: serverTimestamp()
      });

      setStatus({ type: 'success', message: "La vidéo a été associée au bloc avec succès !" });
      setVideoUrl('');
      setSelectedBlockForSupport('');
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de l'association de la vidéo : " + err.message });
    } finally {
      setIsUploadingSupport(false);
    }
  };

  const handleParse = () => {
    try {
      const config = booksConfig[docType];
      let questions: ParsedQuestion[] = [];
      let answers: ParsedAnswer[] = [];

      if (config.parser === 'lange') {
        questions = parseLangeQuestions(questionsText);
        answers = parseLangeAnswers(answersText);
      } else if (config.parser === 'minsante') {
        questions = parseMinsanteQuestions(questionsText);
        answers = parseMinsanteAnswers(answersText);
      } else {
        questions = parsePreTestQuestions(questionsText);
        answers = parsePreTestAnswers(answersText);
      }

      const normalized = normalizeParsedData(questions, answers);
      setParsedData(normalized);
      setStatus({ type: 'success', message: `Analyse réussie : ${questions.length} questions et ${answers.length} réponses trouvées.` });
    } catch (err: any) {
      setStatus({ type: 'error', message: "Erreur d'analyse : " + err.message });
    }
  };

  const processNextBatch = async (currentState: AIPipelineState, retryCount = 0) => {
    if (currentState.status !== 'processing') return;

    const { detectedQuestions, currentBatchIndex, batchSize, processedQuestions, processedAnswers } = currentState;
    
    const startIndex = currentBatchIndex * batchSize;
    if (startIndex >= detectedQuestions.length) {
      // Done!
      setAiState(prev => ({ ...prev, status: 'done' }));
      const normalized = normalizeParsedData(currentState.processedQuestions, currentState.processedAnswers);
      setParsedData(normalized);
      setStatus({ type: 'success', message: `Traitement terminé : ${currentState.processedQuestions.length} questions traitées.` });
      return;
    }

    const endIndex = Math.min(startIndex + batchSize, detectedQuestions.length);
    const batch = detectedQuestions.slice(startIndex, endIndex);

    try {
      const result = await processQuestionsBatch(
        batch, 
        { filiere: filiereSelected, niveau: niveauSelected, chapitre: chapterTitle, bloc: blockTitle },
        processedQuestions.length + 1
      );

      if (result.questions.length !== batch.length) {
         throw new Error(`Incohérence: ${batch.length} posées, ${result.questions.length} reçues.`);
      }

      // Successfully processed batch
      const newProcessedQuestions = [...processedQuestions, ...result.questions];
      const newProcessedAnswers = [...processedAnswers, ...result.answers];
      
      const newState: AIPipelineState = {
        ...currentState,
        processedQuestions: newProcessedQuestions,
        processedAnswers: newProcessedAnswers,
        currentBatchIndex: currentBatchIndex + 1,
      };
      
      setAiState(newState);
      // Directly trigger next batch to form a loop
      setTimeout(() => processNextBatch(newState, 0), 500); 
    } catch (err: any) {
      console.error(err);
      if (retryCount < 2) {
        // Retry automatically
        setStatus({ type: 'error', message: `Erreur (Lot ${currentBatchIndex + 1}). Régénération automatique (Essai ${retryCount + 1}/2)...` });
        setTimeout(() => processNextBatch(currentState, retryCount + 1), 2000);
      } else {
        setAiState(prev => ({ ...prev, status: 'paused', error: err.message }));
        setStatus({ type: 'error', message: `Erreur au lot ${currentBatchIndex + 1} après plusieurs essais : ` + err.message });
      }
    }
  };

  const handleStartBatchProcessing = () => {
    setAiState(prev => {
      const newState = { ...prev, status: 'processing' as const, error: undefined };
      setTimeout(() => processNextBatch(newState), 500);
      return newState;
    });
  };

  const handleResumeBatchProcessing = () => {
    setAiState(prev => {
      const newState = { ...prev, status: 'processing' as const, error: undefined };
      setTimeout(() => processNextBatch(newState), 500);
      return newState;
    });
  };

  const handleCancelAIPipeline = () => {
    setAiState({
      status: 'idle',
      detectedQuestions: [],
      processedQuestions: [],
      processedAnswers: [],
      currentBatchIndex: 0,
      batchSize: 10
    });
    setParsedData(null);
    setStatus(null);
  };

  const handleAIGenerate = async () => {
    if (!aiQuestionsText.trim()) {
      setStatus({ type: 'error', message: "Veuillez coller des questions à analyser." });
      return;
    }
    
    setAiState(prev => ({ ...prev, status: 'segmenting', error: undefined }));
    setStatus(null);
    try {
      const detected = await segmentTextIntoQuestions(aiQuestionsText);
      if (detected.length === 0) {
         throw new Error("Aucune question n'a été trouvée dans le texte.");
      }
      setAiState(prev => ({ ...prev, status: 'segmented_wait_validation', detectedQuestions: detected }));
      setStatus({ type: 'success', message: `Segmentation réussie : ${detected.length} questions détectées.` });
    } catch (err: any) {
      console.error(err);
      setAiState(prev => ({ ...prev, status: 'idle', error: err.message }));
      setStatus({ type: 'error', message: "Erreur lors de la segmentation: " + err.message });
    }
  };

  const handleImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAssocs = files.map(file => ({
      file,
      preview: URL.createObjectURL(file as Blob),
      type: 'question' as const,
      targetNumber: parsedData?.questions[0]?.number || 1,
      caption: ''
    }));
    setImageAssociations(prev => [...prev, ...newAssocs]);
  };

  const handleSpecificImageAdd = (e: React.ChangeEvent<HTMLInputElement>, questionNumber: number, type: 'question' | 'correction' | 'fiche' | 'video') => {
    const files = Array.from(e.target.files || []);
    const newAssocs = files.map(file => ({
      file,
      preview: URL.createObjectURL(file as Blob),
      type,
      targetNumber: questionNumber,
      caption: ''
    }));
    setImageAssociations(prev => [...prev, ...newAssocs]);
  };

  const handleGenerateMindMapAI = async () => {
    if (!parsedData || parsedData.questions.length === 0) {
      setStatus({ type: 'error', message: "Veuillez d'abord analyser les questions pour fournir un contexte à l'IA." });
      return;
    }

    setIsGeneratingMindMap(true);
    setStatus(null);

    try {
      // Create a summary of questions for context
      const context = parsedData.questions.map(q => 
        `Question ${q.number}: ${q.text}\n${q.options.map(o => `${o.letter}) ${o.text}`).join('\n')}`
      ).join('\n\n').substring(0, 5000); // Limit context size

      const generated = await generateMindMap(context);
      setMindMapText(generated);
      setStatus({ type: 'success', message: "Carte mentale générée avec succès par l'IA !" });
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de la génération IA : " + err.message });
    } finally {
      setIsGeneratingMindMap(false);
    }
  };

  const removeImage = (index: number) => {
    setImageAssociations(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const updateImageAssociation = (index: number, updates: Partial<ImageAssociation>) => {
    setImageAssociations(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const sendGlobalNotification = async (title: string, body: string) => {
    try {
      const response = await fetch('/api/broadcast-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body })
      });
      const result = await response.json();
      console.log('Notification result:', result);
    } catch (error) {
      console.warn('Notification background request was blocked or failed:', error);
    }
  };

  const handleSave = async () => {
    if (!parsedData || !blockTitle.trim()) {
      setStatus({ type: 'error', message: "Veuillez analyser les données et donner un titre au bloc." });
      return;
    }

    setLoading(true);
    setStatus({ type: 'success', message: "Enregistrement en cours..." });

    try {
      // 1. Ensure Book exists
      const booksRef = collection(db, 'books');
      const bookQuery = query(
        booksRef, 
        where('name', '==', docType),
        where('filiere', '==', filiereSelected),
        where('niveau', '==', niveauSelected)
      );
      const bookSnap = await getDocs(bookQuery);
      let bookId = '';
      
      if (bookSnap.empty) {
        const newBook = await addDoc(booksRef, {
          name: docType,
          type: booksConfig[docType].type,
          filiere: filiereSelected,
          niveau: niveauSelected,
          createdAt: serverTimestamp()
        });
        bookId = newBook.id;
      } else {
        bookId = bookSnap.docs[0].id;
      }

      // 2. Ensure Chapter exists within Book
      const chaptersRef = collection(db, 'chapters');
      const chapterQuery = query(
        chaptersRef, 
        where('bookId', '==', bookId), 
        where('title', '==', chapterTitle)
      );
      const chapterSnap = await getDocs(chapterQuery);
      let chapterId = '';

      if (chapterSnap.empty) {
        const newChapter = await addDoc(chaptersRef, {
          bookId,
          title: chapterTitle,
          filiere: filiereSelected,
          niveau: niveauSelected,
          createdAt: serverTimestamp()
        });
        chapterId = newChapter.id;
      } else {
        chapterId = chapterSnap.docs[0].id;
      }

      // 3. Create Block
      let summaryImageUrl = null;
      if (summaryImage) {
        const path = `summaries/${Date.now()}_${summaryImage.name}`;
        summaryImageUrl = await uploadFileWithFallback(summaryImage, path);
      }

      let uploadedVideoUrl = null;
      if (videoFile) {
        const path = `videos/${Date.now()}_${videoFile.name}`;
        uploadedVideoUrl = await uploadFileWithFallback(videoFile, path);
      }

      const blockRef = await addDoc(collection(db, 'blocks'), {
        chapterId,
        blockTitle: blockTitle.trim(),
        mindMapText: mindMapText.trim(),
        questionsCount: parsedData.questions.length,
        summaryImageUrl,
        videoUrl: uploadedVideoUrl,
        importDate: serverTimestamp(),
        filiere: filiereSelected,
        niveau: niveauSelected
      });

      // Map and save question groups first to avoid duplication in Firestore
      const groupMap = new Map<string, string>(); // Key: sharedStem, Value: group document ID
      for (const q of parsedData.questions) {
        if (q.isGrouped && q.sharedStem) {
          const key = q.sharedStem.trim();
          if (!groupMap.has(key)) {
            const grpRef = await addDoc(collection(db, 'question_groups'), {
              context: q.sharedStem,
              name: q.groupTitle || 'CAS CLINIQUE',
              blockId: blockRef.id,
              chapterId,
              bookId,
              createdAt: serverTimestamp()
            });
            groupMap.set(key, grpRef.id);
          }
          q.groupId = groupMap.get(key);
          q.sharedStem = undefined; // Nullify to prevent individual question doc duplication
        }
      }

      // 4. Upload images and save questions/answers
      for (const q of parsedData.questions) {
        const qImages = imageAssociations.filter(img => img.type === 'question' && img.targetNumber === q.number);
        const aImages = imageAssociations.filter(img => img.type === 'correction' && img.targetNumber === q.number);
        const fImages = imageAssociations.filter(img => img.type === 'fiche' && img.targetNumber === q.number);
        const vImages = imageAssociations.filter(img => img.type === 'video' && img.targetNumber === q.number);
        
        const imageUrls: string[] = [];
        const correctionImageUrls: string[] = [];
        const courseImages: string[] = [];
        const courseVideos: string[] = [];

        for (const img of qImages) {
          const path = `questions/${blockRef.id}/${q.number}_q_${Date.now()}_${img.file.name}`;
          const url = await uploadFileWithFallback(img.file, path);
          imageUrls.push(url);
        }

        for (const img of aImages) {
          const path = `corrections/${blockRef.id}/${q.number}_c_${Date.now()}_${img.file.name}`;
          const url = await uploadFileWithFallback(img.file, path);
          correctionImageUrls.push(url);
        }

        for (const img of fImages) {
          const path = `fiches/${blockRef.id}/${q.number}_f_${Date.now()}_${img.file.name}`;
          const url = await uploadFileWithFallback(img.file, path);
          courseImages.push(url);
        }

        for (const img of vImages) {
          const path = `course_videos/${blockRef.id}/${q.number}_v_${Date.now()}_${img.file.name}`;
          const url = await uploadFileWithFallback(img.file, path);
          courseVideos.push(url);
        }

        // Handle table data extraction for type TAB
        let tableDataObj = extractedTables[q.number] || null;
        if (!tableDataObj && q.type === 'TAB' && qImages.length > 0) {
          try {
            const b64 = await fileToBase64(qImages[0].file);
            tableDataObj = await analyzeTableImageWithAI({ base64: b64 });
          } catch (automaticExtractErr) {
            console.warn(`Automatic table extraction failed for question ${q.number}:`, automaticExtractErr);
          }
        }

        let firestoreTableData = null;
        if (tableDataObj) {
          firestoreTableData = {
            tableName: tableDataObj.tableName,
            headers: tableDataObj.headers || [],
            blanks: tableDataObj.blanks || [],
            rows: (tableDataObj.rows || []).map((r: any) => {
              if (Array.isArray(r)) {
                return { cells: r };
              }
              return r;
            })
          };
        }

        const qDoc = await addDoc(collection(db, 'questions'), {
          blockId: blockRef.id,
          chapterId,
          bookId,
          number: q.number,
          text: q.text,
          type: q.type || 'QCM',
          options: q.options,
          isGrouped: q.isGrouped || false,
          groupTitle: q.groupTitle || null,
          groupId: q.groupId || null,
          sharedStem: q.sharedStem || null,
          imageUrls,
          courseImages,
          courseVideos,
          tableData: firestoreTableData,
          filiere: filiereSelected,
          niveau: niveauSelected,
          createdAt: serverTimestamp()
        });

        const ans = parsedData.answers.find(a => a.number === q.number);
        if (ans) {
          await setDoc(doc(db, 'answers', qDoc.id), {
            questionId: qDoc.id,
            blockId: blockRef.id,
            chapterId,
            number: ans.number,
            correctLetter: ans.correctLetter,
            correctAnswers: ans.correctLetters || [],
            expectedAnswer: ans.expectedAnswer || null,
            explanation: ans.explanation,
            correctionImageUrls,
            filiere: filiereSelected,
            niveau: niveauSelected,
            createdAt: serverTimestamp()
          });
        }
      }

      setStatus({ type: 'success', message: "Tout a été enregistré avec succès !" });
      
      if (notifyUsers) {
        sendGlobalNotification(
          "Nouveau contenu !",
          `Un nouveau bloc "${blockTitle}" est disponible dans le module ${docType}.`
        );
      }

      setParsedData(null);
      setQuestionsText('');
      setAnswersText('');
      setBlockTitle('');
      setMindMapText('');
      setSummaryImage(null);
      setSummaryImagePreview(null);
      setVideoFile(null);
      setImageAssociations([]);
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de l'enregistrement : " + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCourse = async () => {
    if (!blockTitleCourse.trim() || (!videoFileCourse && !imgFileCourse)) {
      setStatus({ type: 'error', message: "Veuillez donner un titre et importer au moins un document (vidéo ou image)." });
      return;
    }

    setLoadingCourse(true);
    setStatus(null);

    try {
      let videoUrl = '';
      let imageUrl = '';

      if (videoFileCourse) {
        const path = `seriesQ/videos/${Date.now()}_${videoFileCourse.name}`;
        videoUrl = await uploadFileWithFallback(videoFileCourse, path);
      }

      if (imgFileCourse) {
        const path = `seriesQ/images/${Date.now()}_${imgFileCourse.name}`;
        imageUrl = await uploadFileWithFallback(imgFileCourse, path);
      }

      await addDoc(collection(db, 'seriesQ'), {
        title: blockTitleCourse.trim(),
        chapter: chapterCourse,
        docType: docTypeCourse,
        videoUrl,
        imageUrl,
        filiere: 'ECN',
        createdAt: serverTimestamp()
      });

      setStatus({ type: 'success', message: "Série Q enregistrée avec succès !" });
      
      if (notifyUsers) {
        sendGlobalNotification(
          "Nouveau cours disponible !",
          `Le cours "${blockTitleCourse}" vient d'être ajouté aux séries Q.`
        );
      }

      setBlockTitleCourse('');
      setVideoFileCourse(null);
      setImgFileCourse(null);
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: "Erreur lors de la sauvegarde : " + err.message });
    } finally {
      setLoadingCourse(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Mode Selector */}
      <div className="flex flex-wrap items-center gap-4">
        <button 
          onClick={() => setImportMode('questions')}
          className={cn(
            "flex items-center gap-3 px-6 py-3.5 rounded-2xl font-black transition-all active:scale-95",
            importMode === 'questions' 
              ? "bg-blue-600 text-white shadow-xl shadow-blue-200 ring-4 ring-blue-50" 
              : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50 hover:border-blue-200 shadow-sm"
          )}
        >
          <div className={cn("p-1.5 rounded-lg", importMode === 'questions' ? "bg-white/20" : "bg-blue-50")}>
            <FileUp className={cn("w-5 h-5", importMode === 'questions' ? "text-white" : "text-blue-600")} />
          </div>
          <span>Nouveau Bloc Questions</span>
        </button>
        <button 
          onClick={() => {
            setImportMode('pdf_fiche');
            handleFetchBlocks();
          }}
          className={cn(
            "flex items-center gap-3 px-6 py-3.5 rounded-2xl font-black transition-all active:scale-95",
            importMode === 'pdf_fiche' 
              ? "bg-indigo-600 text-white shadow-xl shadow-indigo-200 ring-4 ring-indigo-50" 
              : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50 hover:border-indigo-200 shadow-sm"
          )}
        >
          <div className={cn("p-1.5 rounded-lg", importMode === 'pdf_fiche' ? "bg-white/20" : "bg-indigo-50")}>
            <FileText className={cn("w-5 h-5", importMode === 'pdf_fiche' ? "text-white" : "text-indigo-600")} />
          </div>
          <span>Associer PDF</span>
        </button>
        <button 
          onClick={() => {
            setImportMode('image_fiche');
            handleFetchBlocks();
          }}
          className={cn(
            "flex items-center gap-3 px-6 py-3.5 rounded-2xl font-black transition-all active:scale-95",
            importMode === 'image_fiche' 
              ? "bg-emerald-600 text-white shadow-xl shadow-emerald-200 ring-4 ring-emerald-50" 
              : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50 hover:border-emerald-200 shadow-sm"
          )}
        >
          <div className={cn("p-1.5 rounded-lg", importMode === 'image_fiche' ? "bg-white/20" : "bg-emerald-50")}>
            <BookOpen className={cn("w-5 h-5", importMode === 'image_fiche' ? "text-white" : "text-emerald-600")} />
          </div>
          <span>Associer Image</span>
        </button>
        <button 
          onClick={() => {
            setImportMode('video_support');
            handleFetchBlocks();
          }}
          className={cn(
            "flex items-center gap-3 px-6 py-3.5 rounded-2xl font-black transition-all active:scale-95",
            importMode === 'video_support' 
              ? "bg-blue-600 text-white shadow-xl shadow-blue-200 ring-4 ring-blue-50" 
              : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50 hover:border-blue-200 shadow-sm"
          )}
        >
          <div className={cn("p-1.5 rounded-lg", importMode === 'video_support' ? "bg-white/20" : "bg-blue-50")}>
            <PlayCircle className={cn("w-5 h-5", importMode === 'video_support' ? "text-white" : "text-blue-600")} />
          </div>
          <span>Associer Vidéo</span>
        </button>
        <button 
          onClick={() => setImportMode('course_import')}
          className={cn(
            "flex items-center gap-3 px-6 py-3.5 rounded-2xl font-black transition-all active:scale-95",
            importMode === 'course_import' 
              ? "bg-purple-600 text-white shadow-xl shadow-purple-200 ring-4 ring-purple-50" 
              : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50 hover:border-purple-200 shadow-sm"
          )}
        >
          <div className={cn("p-1.5 rounded-lg", importMode === 'course_import' ? "bg-white/20" : "bg-purple-50")}>
            <GitBranch className={cn("w-5 h-5", importMode === 'course_import' ? "text-white" : "text-purple-600")} />
          </div>
          <span>Importation de Cours</span>
        </button>
      </div>

      {importMode === 'questions' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Column: Config & Input */}
      <div className="space-y-6">
        <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-200/60 shadow-sm space-y-8">
          <section className="space-y-5">
            <h2 className="text-xl font-display font-bold flex items-center gap-3 text-gray-900">
              <div className="p-2 bg-blue-50 rounded-xl text-blue-600"><FileText className="w-5 h-5" /></div>
              Configuration du Bloc
            </h2>
            
            <div className="grid grid-cols-1 gap-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700 ml-1 uppercase tracking-wider text-[10px]">Filière</label>
                  <select 
                    value={filiereSelected}
                    onChange={(e) => { 
                      setFiliereSelected(e.target.value);
                      setNiveauSelected('ALL');
                    }}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-gray-800"
                  >
                    {getFiliereOptions().map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-gray-700 ml-1 uppercase tracking-wider text-[10px]">Niveau</label>
                  <select 
                    value={niveauSelected}
                    onChange={(e) => setNiveauSelected(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-gray-800"
                  >
                    {getLevelsForFiliereDynamic(filiereSelected).map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Type de document (Nom du livre)</label>
                <select 
                  value={docType} 
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium text-gray-800"
                >
                  {Object.keys(booksConfig).map(key => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Nom du chapitre</label>
                
                <div className="relative">
                  <input 
                    type="text"
                    placeholder="🔍 Rechercher un chapitre..."
                    value={chapterSearch}
                    onChange={(e) => {
                      const val = e.target.value;
                      setChapterSearch(val);
                      const filtered = getCombinedChapters().filter(opt => 
                        opt.toLowerCase().includes(val.toLowerCase())
                      );
                      if (filtered.length > 0 && !filtered.includes(chapterTitle)) {
                        setChapterTitle(filtered[0]);
                      }
                    }}
                    className="w-full px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-gray-800 placeholder:text-gray-400 font-medium"
                  />
                  {chapterSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setChapterSearch('');
                        const orig = getCombinedChapters();
                        if (orig.length > 0 && !orig.includes(chapterTitle)) {
                          setChapterTitle(orig[0]);
                        }
                      }}
                      className="absolute right-3 top-2.5 text-xs text-gray-400 hover:text-gray-600 font-semibold"
                    >
                      Effacer
                    </button>
                  )}
                </div>

                <select 
                  value={chapterTitle}
                  onChange={(e) => setChapterTitle(e.target.value)}
                  className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium text-gray-800"
                >
                  {getCombinedChapters()
                    .filter(opt => opt.toLowerCase().includes(chapterSearch.toLowerCase()))
                    .map(opt => (
                      <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                    ))
                  }
                  {getCombinedChapters().filter(opt => opt.toLowerCase().includes(chapterSearch.toLowerCase())).length === 0 && (
                    <option value="" disabled>Aucun chapitre trouvé</option>
                  )}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Titre du bloc</label>
                <input 
                  type="text" 
                  value={blockTitle}
                  onChange={(e) => setBlockTitle(e.target.value)}
                  placeholder="ex: Pédiatrie générale"
                  className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium text-gray-800 placeholder:text-gray-400"
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-indigo-500" />
                    Structure de la Carte Mentale (Optionnel)
                  </div>
                  <button 
                    onClick={handleGenerateMindMapAI}
                    disabled={isGeneratingMindMap || !parsedData}
                    className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-indigo-100 transition-colors disabled:opacity-50"
                  >
                    {isGeneratingMindMap ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Générer avec l'IA
                  </button>
                </label>
                <textarea 
                  value={mindMapText}
                  onChange={(e) => setMindMapText(e.target.value)}
                  placeholder={"#. Titre Principal\n>. Tronc 1\n-. Branche 1\n*. Détail feuille\n>. Tronc 2"}
                  rows={4}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                />
                <p className="text-[10px] text-gray-400 font-medium">Structure basée sur symboles + point : #. (Tronc), {'>.'} (Branche), -. (Sous-branche), *. (Feuille). Chaque ligne doit commencer par "Symbole."</p>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-emerald-500" />
                  Image de Résumé du Cours (Optionnel)
                </label>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => document.getElementById('summary-image-upload')?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors"
                  >
                    <Upload className="w-4 h-4" /> Sélectionner l'image
                  </button>
                  <input 
                    id="summary-image-upload"
                    type="file" 
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setSummaryImage(file);
                        setSummaryImagePreview(URL.createObjectURL(file));
                      }
                    }}
                    className="hidden" 
                  />
                  {summaryImagePreview && (
                    <div className="relative group">
                      <img 
                        src={summaryImagePreview} 
                        className="h-14 w-14 rounded-lg object-cover border border-emerald-200 shadow-sm" 
                        alt="Block summary preview" 
                      />
                      <button 
                        onClick={() => {
                          setSummaryImage(null);
                          setSummaryImagePreview(null);
                        }}
                        className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Plus className="w-3 h-3 rotate-45" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                  <PlayCircle className="w-4 h-4 text-indigo-500" />
                  Vidéo du Cours (.mp4, etc.)
                </label>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => document.getElementById('video-upload')?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-colors"
                  >
                    <Upload className="w-4 h-4" /> Sélectionner la vidéo
                  </button>
                  <input 
                    id="video-upload"
                    type="file" 
                    accept="video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setVideoFile(file);
                    }}
                    className="hidden" 
                  />
                  {videoFile && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
                      <span className="text-xs font-medium text-gray-600 truncate max-w-[150px]">{videoFile.name}</span>
                      <button 
                        onClick={() => setVideoFile(null)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div className="h-px bg-gray-100 w-full" />

          <section className="space-y-5">
            <h2 className="text-xl font-display font-bold flex items-center justify-between text-gray-900">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-xl text-blue-600"><Upload className="w-5 h-5" /></div>
                Import des Textes
              </div>
              <div className="flex items-center bg-gray-100 p-1 rounded-xl">
                <button
                  onClick={() => setQuestionImportMethod('manuel')}
                  className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all", questionImportMethod === 'manuel' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}
                >
                  Manuel
                </button>
                <button
                  onClick={() => setQuestionImportMethod('ia')}
                  className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5", questionImportMethod === 'ia' ? "bg-purple-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700")}
                >
                  <Sparkles className="w-3 h-3" /> Assisté par IA
                </button>
              </div>
            </h2>
            
            {questionImportMethod === 'manuel' ? (
              <>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Texte des Questions</label>
                    <button 
                      onClick={() => questionsFileRef.current?.click()}
                      className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <FileUp className="w-3 h-3" />
                      Importer .txt
                    </button>
                    <input 
                      type="file" 
                      ref={questionsFileRef} 
                      onChange={(e) => handleFileImport(e, 'questions')} 
                      accept=".txt" 
                      className="hidden" 
                    />
                  </div>
                  <textarea 
                    rows={6}
                    value={questionsText}
                    onChange={(e) => setQuestionsText(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                    placeholder="Collez ici le texte des questions..."
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Texte des Réponses</label>
                    <button 
                      onClick={() => answersFileRef.current?.click()}
                      className="text-xs flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-bold bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      Importer .txt
                    </button>
                    <input 
                      type="file" 
                      ref={answersFileRef} 
                      onChange={(e) => handleFileImport(e, 'answers')} 
                      accept=".txt" 
                      className="hidden" 
                    />
                  </div>
                  <textarea 
                    rows={6}
                    value={answersText}
                    onChange={(e) => setAnswersText(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                    placeholder="Collez ici le texte des réponses..."
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Questions à analyser</span>
                  <span className="text-xs text-purple-600 font-medium bg-purple-50 px-2 py-1 rounded-lg">QCM, QROC, Vrai/Faux</span>
                </label>
                <textarea 
                  rows={12}
                  value={aiQuestionsText}
                  onChange={(e) => setAiQuestionsText(e.target.value)}
                  className="w-full p-4 bg-purple-50/30 border border-purple-200/60 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all placeholder:text-purple-300"
                  placeholder="Collez ici le sujet brut contenant les questions. L'IA analysera le texte, proposera les réponses, les explications et les références."
                />
              </div>
            )}
          </section>

          <div className="flex flex-col gap-4 pt-6 mt-4 border-t border-gray-100">
            {questionImportMethod === 'manuel' ? (
              <div className="flex gap-4">
               <button 
                 onClick={handleParse}
                 disabled={loading || !questionsText}
                 className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3.5 px-6 rounded-xl font-bold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
               >
                 {loading ? 'Analyse en cours...' : 'Analyser le contenu'}
               </button>
               <button 
                 onClick={handleCancelAIPipeline}
                 className="px-6 py-3.5 border border-gray-200 rounded-xl font-bold text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
               >
                 Réinitialiser
               </button>
              </div>
            ) : (
               <div className="flex flex-col gap-4 border border-purple-100 bg-purple-50/50 p-4 rounded-xl">
                 {aiState.status === 'idle' && (
                   <div className="flex gap-4">
                     <button 
                       onClick={handleAIGenerate}
                       disabled={!aiQuestionsText}
                       className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3.5 px-6 rounded-xl font-bold hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg shadow-purple-500/30 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
                     >
                       <Sparkles className="w-5 h-5" /> Segmenter et préparer les questions
                     </button>
                     <button onClick={handleCancelAIPipeline} className="px-6 py-3.5 border border-purple-200 bg-white rounded-xl font-bold text-purple-700 hover:bg-purple-100 transition-colors">Réinitialiser</button>
                   </div>
                 )}
                 {aiState.status === 'segmenting' && (
                   <div className="text-center py-4 flex flex-col items-center gap-3">
                     <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                     <p className="text-sm font-medium text-purple-900">Analyse de la structure et segmentation des questions en cours...</p>
                   </div>
                 )}
                 {aiState.status === 'segmented_wait_validation' && (
                   <div className="flex flex-col items-center gap-4 text-center">
                     <div className="bg-white p-4 rounded-xl shadow-sm border border-purple-200 w-full">
                       <h3 className="text-lg font-bold text-purple-900 mb-1">{aiState.detectedQuestions.length} questions détectées</h3>
                       <p className="text-sm text-purple-700">Le texte a été segmenté avec succès. Souhaitez-vous lancer la génération finale par lots de {aiState.batchSize} questions ?</p>
                     </div>
                     <div className="flex gap-4 w-full">
                       <button onClick={handleStartBatchProcessing} className="flex-1 bg-purple-600 text-white font-bold py-3 px-6 rounded-xl shadow-md hover:bg-purple-700 transition-all flex items-center justify-center gap-2"><PlayCircle className="w-5 h-5" /> Démarrer la génération</button>
                       <button onClick={handleCancelAIPipeline} className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-3 px-6 rounded-xl hover:bg-gray-50 transition-all">Annuler</button>
                     </div>
                   </div>
                 )}
                 {['processing', 'paused', 'done'].includes(aiState.status) && (
                   <div className="flex flex-col gap-4">
                     <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-purple-100 shadow-sm">
                       <div className="flex flex-col gap-1">
                         <span className="text-xs font-bold text-gray-500 uppercase">Progression Globale</span>
                         <span className="font-bold text-lg text-purple-900">{aiState.processedQuestions.length} / {aiState.detectedQuestions.length} traitées</span>
                       </div>
                       <div className="flex flex-col items-end gap-1">
                         <span className="text-xs font-bold text-gray-500 uppercase">Lot Actuel</span>
                         <span className="font-bold text-sm text-purple-700">Lot {aiState.currentBatchIndex + 1} / {Math.ceil(aiState.detectedQuestions.length / aiState.batchSize)}</span>
                       </div>
                     </div>
                     
                     <div className="w-full bg-purple-100 rounded-full h-2.5">
                       <div className="bg-purple-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${(aiState.processedQuestions.length / Math.max(1, aiState.detectedQuestions.length)) * 100}%` }}></div>
                     </div>

                     {aiState.status === 'processing' && (
                       <div className="flex items-center justify-center gap-2 text-sm font-medium text-purple-700 bg-white py-2 rounded-lg border border-purple-100">
                         <Loader2 className="w-4 h-4 animate-spin" /> Génération du lot {aiState.currentBatchIndex + 1} en cours...
                       </div>
                     )}

                     {aiState.status === 'paused' && (
                       <div className="flex flex-col gap-3">
                         <div className="text-sm font-medium text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-2">
                           <AlertCircle className="w-5 h-5 flex-shrink-0" />
                           <div className="flex flex-col">
                             <span className="font-bold">Processus interrompu</span>
                             <span>{aiState.error || "Le traitement a été mis en pause."}</span>
                           </div>
                         </div>
                         <div className="flex gap-3">
                           <button onClick={handleResumeBatchProcessing} className="flex-1 bg-purple-600 text-white font-bold py-2.5 rounded-xl hover:bg-purple-700 transition-all flex items-center justify-center gap-2"><PlayCircle className="w-4 h-4" /> Reprendre au lot {aiState.currentBatchIndex + 1}</button>
                           <button onClick={handleCancelAIPipeline} className="px-5 font-bold text-gray-600 hover:bg-white rounded-xl transition-all border border-gray-200">Recommencer à zéro</button>
                         </div>
                       </div>
                     )}

                     {aiState.status === 'done' && (
                       <div className="text-sm font-medium text-green-700 bg-green-50 p-3 rounded-lg border border-green-200 flex items-center gap-2 justify-center">
                         <CheckCircle className="w-5 h-5" /> Terminée ! Résultats fusionnés en dessous.
                       </div>
                     )}

                     {(aiState.status === 'processing' || aiState.status === 'paused' || aiState.status === 'done') && (
                       <button onClick={handleCancelAIPipeline} className="mt-2 text-xs font-bold text-red-600 hover:text-red-700 underline text-center">Annuler et supprimer tout</button>
                     )}
                   </div>
                 )}
               </div>
            )}
          </div>
        </div>

        {/* Image Section - Active only after parse */}
        <div className={cn(
          "bg-white rounded-3xl p-6 md:p-8 border border-gray-200/60 shadow-sm space-y-6 transition-all duration-300",
          !parsedData && "opacity-50 pointer-events-none grayscale-[0.5]"
        )}>
          <h2 className="text-xl font-display font-bold flex items-center gap-3 text-gray-900">
            <div className="p-2 bg-purple-50 rounded-xl text-purple-600"><ImageIcon className="w-5 h-5" /></div>
            Ajouter des Images
          </h2>
          
          <div className="space-y-6">
            <label className="w-full border-2 border-dashed border-purple-200 bg-purple-50/30 rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer hover:bg-purple-50 hover:border-purple-300 transition-all group">
              <div className="p-4 bg-white rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
                <Plus className="w-8 h-8 text-purple-500" />
              </div>
              <span className="text-sm font-bold text-purple-700">Sélectionner des images</span>
              <span className="text-xs text-purple-400 mt-1">PNG, JPG, GIF acceptés</span>
              <input type="file" multiple accept="image/*" onChange={handleImageAdd} className="hidden" />
            </label>

            <div className="space-y-4">
              {imageAssociations.map((assoc, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row gap-4 p-4 border border-gray-200 rounded-2xl bg-white shadow-sm">
                  <div className="w-full sm:w-28 h-28 relative rounded-xl overflow-hidden flex-shrink-0 border border-gray-100">
                    <img src={assoc.preview} alt="preview" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => removeImage(idx)}
                      className="absolute top-2 right-2 bg-red-500/90 backdrop-blur-sm text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Type</label>
                      <select 
                        value={assoc.type}
                        onChange={(e) => updateImageAssociation(idx, { type: e.target.value as any })}
                        className="w-full p-1.5 text-sm border rounded bg-white"
                      >
                        <option value="question">Image de question</option>
                        <option value="correction">Image de correction</option>
                        <option value="fiche">Fiche de cours</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Question N°</label>
                      <select 
                        value={assoc.targetNumber}
                        onChange={(e) => updateImageAssociation(idx, { targetNumber: parseInt(e.target.value) })}
                        className="w-full p-1.5 text-sm border rounded bg-white"
                      >
                        {parsedData?.questions.map(q => (
                          <option key={q.number} value={q.number}>Question {q.number}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Légende (Optionnel)</label>
                      <input 
                        type="text"
                        value={assoc.caption}
                        onChange={(e) => updateImageAssociation(idx, { caption: e.target.value })}
                        placeholder="Titre ou description de l'image"
                        className="w-full p-1.5 text-sm border rounded bg-white"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Preview */}
      <div className="space-y-6 bg-gray-50/50 p-6 md:p-8 rounded-3xl border border-gray-200/60 min-h-[600px] flex flex-col relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-100/30 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2" />
        
        <h2 className="text-xl font-display font-bold flex items-center gap-3 text-gray-900">
          <div className="p-2 bg-blue-50 rounded-xl text-blue-600"><Eye className="w-5 h-5" /></div>
          Prévisualisation
        </h2>

        {status && (
          <div className={cn(
            "p-4 rounded-2xl flex items-start gap-3 border shadow-sm",
            status.type === 'success' ? "bg-green-50/80 backdrop-blur-sm border-green-200 text-green-800" : "bg-red-50/80 backdrop-blur-sm border-red-200 text-red-800"
          )}>
            {status.type === 'success' ? <CheckCircle className="w-5 h-5 mt-0.5" /> : <AlertCircle className="w-5 h-5 mt-0.5" />}
            <p className="text-sm font-medium">{status.message}</p>
          </div>
        )}

        {!parsedData ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 space-y-4 bg-white/50 rounded-2xl border border-dashed border-gray-200">
            <FileText className="w-16 h-16 opacity-20" />
            <p className="font-medium text-lg">Aucune donnée analysée pour le moment</p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-gray-200/60 shadow-sm mb-2">
              <span className="text-xs font-bold text-blue-700 uppercase tracking-wider bg-blue-50 px-3 py-1.5 rounded-lg">Format : {docType}</span>
              <span className="text-sm text-gray-600 font-bold bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">{parsedData.questions.length} Q / {parsedData.answers.length} R</span>
            </div>
            <div className="flex-1 space-y-5 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar">
              {(() => {
                const elements: React.ReactNode[] = [];
                let currentGroupStem: string | null = null;
                let currentGroupName: string | null = null;
                let currentGroupQuestions: any[] = [];

                const renderSingleQuestion = (q: any, isInsideGroup: boolean = false) => {
                  const ans = parsedData.answers.find(a => a.number === q.number);
                  const qImages = imageAssociations.filter(img => img.type === 'question' && img.targetNumber === q.number);
                  const aImages = imageAssociations.filter(img => img.type === 'correction' && img.targetNumber === q.number);
                  const fImages = imageAssociations.filter(img => img.type === 'fiche' && img.targetNumber === q.number);
                  
                  return (
                    <div key={`q-preview-${q.number}`} className={cn(
                      "bg-white p-5 rounded-2xl border shadow-sm space-y-4 hover:shadow-md transition-shadow",
                      isInsideGroup ? "border-amber-100" : "border-gray-200/60"
                    )}>
                      <div className="flex justify-between items-start flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm shadow-blue-200">Q{q.number}</span>
                          <label className="cursor-pointer text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors border border-blue-100">
                            <ImageIcon className="w-3.5 h-3.5" /> Q
                            <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleSpecificImageAdd(e, q.number, 'question')} />
                          </label>
                          <label className="cursor-pointer text-xs flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-bold bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg transition-colors border border-emerald-100">
                            <ImageIcon className="w-3.5 h-3.5" /> Fiche
                            <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleSpecificImageAdd(e, q.number, 'fiche')} />
                          </label>
                          {questionImportMethod === 'ia' && (
                            <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-0.5 shadow-sm">
                              <button 
                                onClick={() => {
                                  const newText = window.prompt("Modifier la question :", q.text);
                                  if (newText !== null && newText.trim() !== '') {
                                    setParsedData(prev => prev ? {
                                      ...prev,
                                      questions: prev.questions.map(question => question.number === q.number ? { ...question, text: newText } : question)
                                    } : null);
                                  }
                                }}
                                className="px-2 py-1 text-[10px] font-bold text-gray-600 hover:bg-white hover:text-blue-600 rounded cursor-pointer transition-all"
                              >
                                Modifier
                              </button>
                              <div className="w-px bg-gray-200 my-1 mx-0.5"></div>
                              <button 
                                onClick={() => {
                                  if (window.confirm("Supprimer cette question ?")) {
                                    setParsedData(prev => prev ? {
                                      questions: prev.questions.filter(question => question.number !== q.number),
                                      answers: prev.answers.filter(answer => answer.number !== q.number),
                                    } : null);
                                  }
                                }}
                                className="px-2 py-1 text-[10px] font-bold text-gray-600 hover:bg-white hover:text-red-600 rounded cursor-pointer transition-all"
                              >
                                Supprimer
                              </button>
                              <div className="w-px bg-gray-200 my-1 mx-0.5"></div>
                              <button 
                                onClick={async () => {
                                  setStatus({ type: 'success', message: 'Régénération de la question ' + q.number + '...' });
                                  try {
                                    const result = await generateQuestionsWithAI(q.text + (ans ? '\\nExplication existante: ' + ans.explanation : ''), {
                                      filiere: filiereSelected,
                                      niveau: niveauSelected,
                                      chapitre: chapterTitle,
                                      bloc: blockTitle
                                    });
                                    if (result.questions.length > 0 && result.answers.length > 0) {
                                      const regeneratedQ = { ...result.questions[0], number: q.number };
                                      const regeneratedA = { ...result.answers[0], number: q.number };
                                      setParsedData(prev => {
                                        if (!prev) return null;
                                        const nextQ = prev.questions.map(question => question.number === q.number ? regeneratedQ : question);
                                        const nextA = prev.answers.map(answer => answer.number === q.number ? regeneratedA : answer);
                                        return normalizeParsedData(nextQ, nextA);
                                      });
                                      setStatus({ type: 'success', message: 'Question ' + q.number + ' régénérée.' });
                                    }
                                  } catch (e: any) {
                                    setStatus({ type: 'error', message: 'Erreur lors de la régénération: ' + e.message });
                                  }
                                }}
                                className="px-2 py-1 text-[10px] font-bold text-gray-600 hover:bg-white hover:text-purple-600 rounded cursor-pointer transition-all flex items-center gap-1"
                              >
                                <Sparkles className="w-3 h-3" /> Régénérer
                              </button>
                            </div>
                          )}
                        </div>
                        {ans ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1.5 rounded-lg border border-green-200">Rép: {ans.correctLetter}</span>
                            <span className="text-[10px] text-gray-400 font-medium bg-gray-50 px-2 py-1 rounded border border-gray-100">Extrait: {ans.explanation.substring(0, 30)}...</span>
                          </div>
                        ) : (
                          <span className="bg-red-100 text-red-800 text-xs font-bold px-3 py-1.5 rounded-lg border border-red-200">Rép. manquante</span>
                        )}
                      </div>
                      
                      {!isInsideGroup && q.isGrouped && q.sharedStem && (
                        <div className="mb-3 p-4 bg-amber-50/50 border border-amber-100 rounded-xl text-sm relative overflow-hidden">
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400" />
                          <p className="font-bold text-amber-800 uppercase tracking-wider mb-1.5">{q.groupTitle}</p>
                          <p className="text-gray-700 italic">{q.sharedStem}</p>
                        </div>
                      )}
                      
                      {qImages.length > 0 && (
                        <div className="flex gap-3 overflow-x-auto py-2">
                          {qImages.map((img, i) => (
                            <img key={`q-${i}`} src={img.preview} className="h-24 w-auto rounded-lg border border-blue-200 shadow-sm object-cover" alt="preview" />
                          ))}
                        </div>
                      )}
                      {fImages.length > 0 && (
                        <div className="flex gap-3 overflow-x-auto py-2">
                          {fImages.map((img, i) => (
                            <div key={`f-${i}`} className="relative">
                              <span className="absolute top-1 left-1 bg-emerald-500 text-white text-[10px] px-1 rounded font-bold">Fiche</span>
                              <img src={img.preview} className="h-24 w-auto rounded-lg border border-emerald-200 shadow-sm object-cover" alt="preview fiche" />
                            </div>
                          ))}
                        </div>
                      )}

                      <p className="text-base text-gray-900 font-medium leading-relaxed">{q.text}</p>
                      
                      {q.type === 'TAB' ? (
                        <div className="mt-2 space-y-3">
                          <span className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-purple-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                            Tableau interactif [TAB]
                          </span>
                          
                          {qImages.length === 0 ? (
                            <div className="text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100/60 text-xs font-semibold">
                              ⚠️ Veuillez ajouter l'image du tableau pour permettre l'extraction automatique par l'IA.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {!extractedTables[q.number] ? (
                                <button
                                  type="button"
                                  disabled={analyzingTableNum === q.number}
                                  onClick={async () => {
                                    setAnalyzingTableNum(q.number);
                                    setStatus({ type: 'success', message: `Analyse et reconstruction du tableau Q${q.number} avec l'IA...` });
                                    try {
                                      const base64 = await fileToBase64(qImages[0].file);
                                      const table = await analyzeTableImageWithAI({ base64 });
                                      setExtractedTables(prev => ({ ...prev, [q.number]: table }));
                                      setStatus({ type: 'success', message: `Tableau Q${q.number} extrait avec succès !` });
                                    } catch (err: any) {
                                      console.error(err);
                                      setStatus({ type: 'error', message: `Erreur d'analyse : ${err?.message || err}` });
                                    } finally {
                                      setAnalyzingTableNum(null);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 text-xs text-indigo-700 font-bold bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-xl transition-all border border-indigo-100 cursor-pointer shadow-sm disabled:opacity-50"
                                >
                                  {analyzingTableNum === q.number ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                  Reconstruire le tableau avec l'IA
                                </button>
                              ) : (
                                <div className="space-y-2 border border-dashed border-indigo-200 p-4 rounded-xl bg-indigo-50/20">
                                  <div className="flex items-center justify-between">
                                    <h4 className="font-extrabold text-xs text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                                      Tableau reconstruit : {extractedTables[q.number].tableName}
                                    </h4>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExtractedTables(prev => {
                                          const copy = { ...prev };
                                          delete copy[q.number];
                                          return copy;
                                        });
                                      }}
                                      className="text-[10px] text-red-500 hover:underline font-bold"
                                    >
                                      Réinitialiser
                                    </button>
                                  </div>
                                  
                                  <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm max-w-full">
                                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                                      <thead className="bg-gray-50 text-gray-700">
                                        <tr>
                                          {extractedTables[q.number].headers.map((h, hIdx) => (
                                            <th key={hIdx} className="px-3 py-2 text-left font-bold capitalize border-b border-r last:border-r-0 border-gray-200">
                                              {h}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-100 text-gray-600">
                                        {extractedTables[q.number].rows.map((row, rIdx) => (
                                          <tr key={rIdx} className="hover:bg-gray-50/40">
                                            {row.map((cell, cIdx) => {
                                              const isBlank = extractedTables[q.number].blanks.some(b => b.rowIndex === rIdx && b.colIndex === cIdx);
                                              return (
                                                <td key={cIdx} className={cn(
                                                  "px-3 py-2 border-r last:border-r-0 border-gray-100",
                                                  isBlank ? "bg-amber-50 font-semibold text-amber-900" : ""
                                                )}>
                                                  {isBlank ? (
                                                    <span className="flex items-center gap-1 text-amber-700">
                                                      [ ] <span className="font-normal opacity-85 text-[10px]">({cell})</span>
                                                    </span>
                                                  ) : cell}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="text-[10px] text-amber-700 font-bold flex items-center gap-1">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                    Les cellules en beige seront à compléter par l'étudiant directement.
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 pl-3 border-l-2 border-blue-100">
                          {q.options?.map((opt: any, oIdx: number) => (
                            <p key={oIdx} className="text-sm text-gray-600 bg-gray-50/50 p-2 rounded-lg">
                              <span className="font-bold text-gray-800">({opt.letter})</span> {opt.text}
                            </p>
                          ))}
                        </div>
                      )}
                      
                      {ans && (
                        <div className="mt-4 text-sm bg-gray-50 p-4 rounded-xl border border-gray-200/60">
                          <div className="flex justify-between items-center mb-3">
                            <p className="font-bold text-gray-500 uppercase tracking-wider text-xs">Explication :</p>
                            <div className="flex gap-2">
                              <label className="cursor-pointer text-xs flex items-center gap-1 text-purple-600 hover:text-purple-700 font-bold bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded-lg transition-colors border border-purple-100">
                                <ImageIcon className="w-3.5 h-3.5" /> Correction
                                <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleSpecificImageAdd(e, q.number, 'correction')} />
                              </label>
                              <label className="cursor-pointer text-xs flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-bold bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg transition-colors border border-emerald-100">
                                <ImageIcon className="w-3.5 h-3.5" /> Fiche
                                <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleSpecificImageAdd(e, q.number, 'fiche')} />
                              </label>
                              <label className="cursor-pointer text-xs flex items-center gap-1 text-red-600 hover:text-red-700 font-bold bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors border border-red-100">
                                <PlayCircle className="w-3.5 h-3.5" /> Vidéo
                                <input type="file" multiple accept="video/*" className="hidden" onChange={(e) => handleSpecificImageAdd(e, q.number, 'video')} />
                              </label>
                            </div>
                          </div>
                          {aImages.length > 0 && (
                            <div className="flex gap-3 overflow-x-auto py-2 mb-3">
                              {aImages.map((img, i) => (
                                <img key={i} src={img.preview} className="h-20 w-auto rounded-lg border border-gray-200 shadow-sm object-cover" alt="preview" />
                              ))}
                            </div>
                          )}
                          <p className="text-gray-700 italic leading-relaxed">{ans.explanation}</p>
                        </div>
                      )}
                    </div>
                  );
                };

                const flushGroup = (keyStem: string | null, name: string | null, qList: any[]) => {
                  if (qList.length === 0) return;
                  if (keyStem) {
                    const uniqueKey = `group-${keyStem.substring(0, 20)}-${qList[0].number}`;
                    elements.push(
                      <div key={uniqueKey} className="p-6 bg-amber-50/40 border border-amber-200/80 rounded-3xl space-y-4 shadow-sm relative overflow-hidden my-4">
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500" />
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black uppercase tracking-widest text-amber-800 bg-amber-100/80 px-3 py-1 rounded-full border border-amber-200">
                            {name || 'CAS CLINIQUE'} ({qList.length} questions associées)
                          </span>
                        </div>
                        <div className="p-4 bg-white/80 border border-amber-100 rounded-2xl">
                          <p className="text-gray-800 font-semibold italic leading-relaxed whitespace-pre-line">{keyStem}</p>
                        </div>
                        <div className="space-y-4 pl-4 border-l-2 border-dashed border-amber-200">
                          {qList.map((q) => renderSingleQuestion(q, true))}
                        </div>
                      </div>
                    );
                  } else {
                    qList.forEach(q => {
                      elements.push(renderSingleQuestion(q, false));
                    });
                  }
                };

                parsedData.questions.forEach((q) => {
                  const isGroupMatch = q.isGrouped && q.sharedStem;
                  if (isGroupMatch) {
                    if (currentGroupStem === q.sharedStem) {
                      currentGroupQuestions.push(q);
                    } else {
                      if (currentGroupQuestions.length > 0) {
                        flushGroup(currentGroupStem, currentGroupName, currentGroupQuestions);
                      }
                      currentGroupStem = q.sharedStem || null;
                      currentGroupName = q.groupTitle || 'CAS CLINIQUE';
                      currentGroupQuestions = [q];
                    }
                  } else {
                    if (currentGroupQuestions.length > 0) {
                      flushGroup(currentGroupStem, currentGroupName, currentGroupQuestions);
                      currentGroupQuestions = [];
                      currentGroupStem = null;
                      currentGroupName = null;
                    }
                    elements.push(renderSingleQuestion(q, false));
                  }
                });

                if (currentGroupQuestions.length > 0) {
                  flushGroup(currentGroupStem, currentGroupName, currentGroupQuestions);
                }

                return elements;
              })()}
            </div>

            <label className="flex items-center gap-3 p-4 bg-blue-50/50 rounded-2xl border border-blue-100 cursor-pointer hover:bg-blue-50 transition-colors mt-6">
              <input 
                type="checkbox" 
                className="w-5 h-5 rounded-lg border-blue-300 text-blue-600 focus:ring-blue-500"
                checked={notifyUsers}
                onChange={(e) => setNotifyUsers(e.target.checked)}
              />
              <div className="flex flex-col">
                <span className="text-sm font-bold text-blue-900 leading-tight">Notifier tous les utilisateurs</span>
                <p className="text-[10px] text-blue-600 font-medium uppercase tracking-wider">Envoie une notification push instantanée</p>
              </div>
            </label>

            <button 
              onClick={handleSave}
              disabled={loading}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-4 px-6 rounded-2xl font-bold text-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg shadow-green-500/30 disabled:opacity-50 disabled:shadow-none mt-6"
            >
              {loading ? 'Enregistrement en cours...' : 'Enregistrer tout dans Firebase'}
            </button>
          </>
        )}
      </div>
    </div>
      )}

      {(importMode === 'pdf_fiche' || importMode === 'image_fiche' || importMode === 'video_support') && (
        <div className="max-w-3xl mx-auto w-full bg-white rounded-[2.5rem] p-6 md:p-10 border border-gray-100 shadow-xl shadow-gray-200/50 space-y-10 animate-in zoom-in-95 duration-500">
          <div className="text-center space-y-4">
            <div className={cn(
              "w-24 h-24 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-inner border border-white",
              importMode === 'pdf_fiche' ? "bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-600" : 
              importMode === 'image_fiche' ? "bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-600" :
              "bg-gradient-to-br from-blue-50 to-emerald-50 text-blue-600"
            )}>
              {importMode === 'pdf_fiche' && <FileText className="w-12 h-12" />}
              {importMode === 'image_fiche' && <BookOpen className="w-12 h-12" />}
              {importMode === 'video_support' && <PlayCircle className="w-12 h-12" />}
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-display font-black text-gray-900 tracking-tight">
                {importMode === 'pdf_fiche' && "Associer une Fiche PDF"}
                {importMode === 'image_fiche' && "Associer une Image (Fiche)"}
                {importMode === 'video_support' && "Associer une Vidéo"}
              </h2>
              <p className="text-gray-500 font-medium max-w-md mx-auto leading-relaxed">
                {importMode === 'pdf_fiche' && "Ajoutez une fiche de cours support au format PDF à un bloc de questions."} 
                {importMode === 'image_fiche' && "Ajoutez une image de cours (fiche illustrative) à un bloc de questions."}
                {importMode === 'video_support' && "Associez une vidéo de cours (YouTube, etc.) à un bloc de questions."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-gray-50/50 p-6 rounded-3xl border border-gray-100">
            <div className="space-y-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em] px-1">Filtres de Bloc</h3>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Filière & Niveau</label>
                  <div className="flex gap-2">
                    <select 
                      value={filiereSelected}
                      onChange={(e) => setFiliereSelected(e.target.value)}
                      className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-100 outline-none transition-all font-bold text-gray-800"
                    >
                      {getFiliereOptions().map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                    </select>
                    <select 
                      value={niveauSelected}
                      onChange={(e) => setNiveauSelected(e.target.value)}
                      className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-100 outline-none transition-all font-bold text-gray-800"
                    >
                      <option value="ALL">Tous niveaux</option>
                      {getLevelsForFiliereDynamic(filiereSelected).map(level => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Livre & Chapitre</label>
                  <div className="space-y-2">
                    <select 
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-100 outline-none transition-all font-bold text-gray-800"
                    >
                      {Object.keys(booksConfig).map(book => <option key={book} value={book}>{book}</option>)}
                    </select>
                    <div className="relative">
                      <input 
                        type="text"
                        placeholder="🔍 Rechercher un chapitre..."
                        value={chapterSearchSupport}
                        onChange={(e) => {
                          const val = e.target.value;
                          setChapterSearchSupport(val);
                          const filtered = getCombinedChapters().filter(opt => 
                            opt.toLowerCase().includes(val.toLowerCase())
                          );
                          if (filtered.length > 0 && !filtered.includes(chapterTitle)) {
                            setChapterTitle(filtered[0]);
                          }
                        }}
                        className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-gray-800 placeholder:text-gray-400 font-semibold"
                      />
                      {chapterSearchSupport && (
                        <button
                          type="button"
                          onClick={() => {
                            setChapterSearchSupport('');
                            const orig = getCombinedChapters();
                            if (orig.length > 0 && !orig.includes(chapterTitle)) {
                              setChapterTitle(orig[0]);
                            }
                          }}
                          className="absolute right-3 top-2.5 text-sm text-gray-400 hover:text-gray-600 font-bold"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    <select 
                      value={chapterTitle}
                      onChange={(e) => setChapterTitle(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-100 outline-none transition-all font-bold text-gray-800"
                    >
                      {getCombinedChapters()
                        .filter(opt => opt.toLowerCase().includes(chapterSearchSupport.toLowerCase()))
                        .map(opt => <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>)
                      }
                      {getCombinedChapters().filter(opt => opt.toLowerCase().includes(chapterSearchSupport.toLowerCase())).length === 0 && (
                        <option value="" disabled>Aucun chapitre trouvé</option>
                      )}
                    </select>
                  </div>
                </div>
                <button 
                  onClick={handleFetchBlocks}
                  disabled={isFetchingBlocks}
                  className="w-full py-4 bg-white border-2 border-dashed border-gray-200 rounded-2xl font-black text-gray-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2 group"
                >
                  {isFetchingBlocks ? <Loader2 className="w-5 h-5 animate-spin" /> : <Eye className="w-5 h-5 group-hover:scale-110 transition-transform" />}
                  <span>Charger les Blocs</span>
                </button>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em] px-1">Cibles & Support</h3>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Sélectionner le Bloc</label>
                  <select 
                    value={selectedBlockForSupport}
                    onChange={(e) => setSelectedBlockForSupport(e.target.value)}
                    disabled={availableBlocks.length === 0}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-4 focus:ring-indigo-100 outline-none transition-all font-bold text-gray-800 disabled:opacity-50"
                  >
                    <option value="">-- Choisir un bloc --</option>
                    {availableBlocks.map(block => (
                      <option key={block.id} value={block.id}>{block.title}</option>
                    ))}
                  </select>
                </div>

                {importMode === 'pdf_fiche' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Fichier PDF</label>
                    <div 
                      onClick={() => document.getElementById('pdf-upload')?.click()}
                      className={cn(
                        "w-full p-8 border-2 border-dashed rounded-3xl transition-all cursor-pointer flex flex-col items-center justify-center gap-3 text-center group",
                        pdfFile ? "bg-indigo-50 border-indigo-300" : "bg-white border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30"
                      )}
                    >
                      <div className={cn(
                        "p-3 rounded-2xl transition-colors",
                        pdfFile ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-gray-100 text-gray-400 group-hover:bg-indigo-100 group-hover:text-indigo-600"
                      )}>
                        <FileUp className="w-8 h-8" />
                      </div>
                      <div>
                        <p className={cn("font-black text-sm", pdfFile ? "text-indigo-900" : "text-gray-500")}>
                          {pdfFile ? pdfFile.name : "Cliquez pour choisir un PDF"}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Format PDF uniquement</p>
                      </div>
                      <input 
                        id="pdf-upload"
                        type="file" 
                        accept="application/pdf"
                        onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                        className="hidden" 
                      />
                    </div>
                  </div>
                )}

                {importMode === 'image_fiche' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Fiche Image</label>
                    <div 
                      onClick={() => document.getElementById('image-upload')?.click()}
                      className={cn(
                        "w-full p-8 border-2 border-dashed rounded-3xl transition-all cursor-pointer flex flex-col items-center justify-center gap-3 text-center group",
                        imageFile ? "bg-emerald-50 border-emerald-300" : "bg-white border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/30"
                      )}
                    >
                      <div className={cn(
                        "p-3 rounded-2xl transition-colors",
                        imageFile ? "bg-emerald-600 text-white shadow-lg shadow-emerald-200" : "bg-gray-100 text-gray-400 group-hover:bg-emerald-100 group-hover:text-emerald-600"
                      )}>
                        <FileUp className="w-8 h-8" />
                      </div>
                      <div>
                        <p className={cn("font-black text-sm", imageFile ? "text-emerald-900" : "text-gray-500")}>
                          {imageFile ? imageFile.name : "Cliquez pour choisir une image"}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">PNG, JPG, JPEG</p>
                      </div>
                      <input 
                        id="image-upload"
                        type="file" 
                        accept="image/*"
                        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                        className="hidden" 
                      />
                    </div>
                  </div>
                )}

                {importMode === 'video_support' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">URL Vidéo (YouTube)</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <PlayCircle className="w-5 h-5 text-gray-300 group-focus-within:text-blue-500 transition-colors" />
                      </div>
                      <input 
                        type="text"
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl focus:ring-4 focus:ring-blue-100 outline-none transition-all font-medium text-gray-800 placeholder:text-gray-300 shadow-sm"
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2 px-1">Lien de partage ou URL complète</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <button 
            onClick={() => {
              if (importMode === 'pdf_fiche') handleUploadPDF();
              else if (importMode === 'image_fiche') handleUploadImage();
              else handleUpdateVideo();
            }}
            disabled={isUploadingSupport || !selectedBlockForSupport || (importMode === 'pdf_fiche' ? !pdfFile : importMode === 'image_fiche' ? !imageFile : !videoUrl)}
            className={cn(
              "w-full py-5 px-8 rounded-3xl font-black text-xl transition-all shadow-2xl flex items-center justify-center gap-3 active:scale-[0.98] text-white",
              importMode === 'pdf_fiche' 
                ? "bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 shadow-indigo-500/40" :
              importMode === 'image_fiche'
                ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-500/40"
                : "bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 shadow-blue-500/40"
            )}
          >
            {isUploadingSupport ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle className="w-6 h-6" />}
            <span>
              {importMode === 'pdf_fiche' && "Associer la Fiche PDF"}
              {importMode === 'image_fiche' && "Associer l'Image"}
              {importMode === 'video_support' && "Associer la Vidéo"}
            </span>
          </button>
        </div>
      )}

      {importMode === 'course_import' && (
        <div className="max-w-2xl mx-auto w-full bg-white rounded-[2.5rem] p-8 md:p-10 border border-gray-100 shadow-2xl shadow-gray-200/50 space-y-8 animate-in slide-in-from-bottom-10 duration-500">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-inner border border-white">
              <BookOpen className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-display font-black text-gray-900 tracking-tight">Importation de Cours</h2>
              <p className="text-gray-500 font-medium leading-relaxed">Gérez le contenu spécial "Série Q" et autres ressources de cours.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 bg-gray-50/50 p-6 rounded-3xl border border-gray-100">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Section Type de document</label>
                <select 
                  value={docTypeCourse} 
                  onChange={(e) => setDocTypeCourse(e.target.value)}
                  className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 outline-none transition-all font-bold text-gray-800"
                >
                  <option value="Série Q">Série Q</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Sélection du Chapitre</label>
                <select 
                  value={chapterCourse} 
                  onChange={(e) => setChapterCourse(e.target.value)}
                  className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 outline-none transition-all font-bold text-gray-800"
                >
                  {Array.from({ length: 400 }, (_, i) => `Q${(i + 1).toString().padStart(3, '0')}`).map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Titre du bloc</label>
                <input 
                  type="text" 
                  value={blockTitleCourse}
                  onChange={(e) => setBlockTitleCourse(e.target.value)}
                  placeholder="ex: Introduction à l'épisode Q001"
                  className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 outline-none transition-all font-bold text-gray-800 placeholder:text-gray-300 shadow-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Support Vidéo</label>
                  <input 
                    type="file" 
                    id="course-video-upload" 
                    accept="video/*" 
                    className="hidden" 
                    onChange={(e) => setVideoFileCourse(e.target.files?.[0] || null)}
                  />
                  <button 
                    onClick={() => document.getElementById('course-video-upload')?.click()}
                    className={cn(
                      "w-full py-3 px-4 border-2 border-dashed rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                      videoFileCourse ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600"
                    )}
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span className="truncate">{videoFileCourse ? videoFileCourse.name : "Importer Vidéo"}</span>
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Support Image (Fiche)</label>
                  <input 
                    type="file" 
                    id="course-image-upload" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={(e) => setImgFileCourse(e.target.files?.[0] || null)}
                  />
                  <button 
                    onClick={() => document.getElementById('course-image-upload')?.click()}
                    className={cn(
                      "w-full py-3 px-4 border-2 border-dashed rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                      imgFileCourse ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-gray-200 text-gray-500 hover:border-emerald-400 hover:text-emerald-600"
                    )}
                  >
                    <ImageIcon className="w-4 h-4" />
                    <span className="truncate">{imgFileCourse ? imgFileCourse.name : "Importer Image"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-3 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 cursor-pointer hover:bg-indigo-50 transition-colors mb-4">
            <input 
              type="checkbox" 
              className="w-5 h-5 rounded-lg border-indigo-300 text-indigo-600 focus:ring-indigo-500"
              checked={notifyUsers}
              onChange={(e) => setNotifyUsers(e.target.checked)}
            />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-indigo-900 leading-tight">Notifier tous les utilisateurs</span>
              <p className="text-[10px] text-indigo-600 font-medium uppercase tracking-wider">Envoie une notification push pour ce nouveau cours</p>
            </div>
          </label>

          <button 
            onClick={handleSaveCourse}
            disabled={loadingCourse || !blockTitleCourse || (!videoFileCourse && !imgFileCourse)}
            className="w-full bg-indigo-600 text-white py-5 rounded-[2rem] font-black text-xl shadow-2xl shadow-indigo-200 hover:bg-indigo-700 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-3"
          >
            {loadingCourse ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle className="w-6 h-6" />}
            <span>Valider l'importation</span>
          </button>
        </div>
      )}

      {status && (
        <div className={cn(
          "fixed bottom-8 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl border-2 flex items-center gap-4 animate-in slide-in-from-bottom-10 duration-500 z-[100]",
          status.type === 'success' 
            ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
            : "bg-red-50 border-red-100 text-red-800"
        )}>
          {status.type === 'success' ? <CheckCircle className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
          <span className="font-black tracking-tight">{status.message}</span>
          <button onClick={() => setStatus(null)} className="ml-4 hover:scale-110 transition-transform">
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>
      )}
    </div>
  );
};

export default ImportView;
