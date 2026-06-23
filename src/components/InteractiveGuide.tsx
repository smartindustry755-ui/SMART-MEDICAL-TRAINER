import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, X, Info, Book, Target, Calendar, AlertCircle, ArrowRight, HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface GuideStep {
  id: string;
  targetId?: string;
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

interface InteractiveGuideProps {
  onboardingCompleted: boolean | null;
  tutorialStepsCompleted: string[];
  onCompleteOnboarding: () => void;
  onCompleteStep: (stepId: string) => void;
  onSkipAll: () => void;
  currentView: string;
}

export const InteractiveGuide: React.FC<InteractiveGuideProps> = ({
  onboardingCompleted,
  tutorialStepsCompleted,
  onCompleteOnboarding,
  onCompleteStep,
  onSkipAll,
  currentView
}) => {
  const [showOnboarding, setShowOnboarding] = useState(onboardingCompleted === false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [activeTutorialStep, setActiveTutorialStep] = useState<GuideStep | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (onboardingCompleted !== null) {
      setShowOnboarding(onboardingCompleted === false);
      if (onboardingCompleted === false) {
        setOnboardingStep(0);
      }
    }
  }, [onboardingCompleted]);

  const onboardingScreens = [
    {
      title: "Bienvenue sur Smart Tutor",
      content: "Votre compagnon intelligent pour réussir vos examens médicaux. Une plateforme conçue pour optimiser votre apprentissage.",
      icon: <Book className="w-16 h-16 text-indigo-600" />,
      color: "bg-indigo-50"
    },
    {
      title: "Apprentissage Adaptatif",
      content: "Suivez votre progression, identifiez vos points faibles et transformez vos erreurs en opportunités de réussite.",
      icon: <Target className="w-16 h-16 text-amber-600" />,
      color: "bg-amber-50"
    },
    {
      title: "Prêt à commencer ?",
      content: "Découvrez comment Smart Tutor peut transformer votre méthode de travail dès aujourd'hui.",
      icon: <ArrowRight className="w-16 h-16 text-emerald-600" />,
      color: "bg-emerald-50"
    }
  ];

  const dashboardSteps: GuideStep[] = [
    {
      id: 'step_training',
      targetId: 'module-books',
      title: 'Entraînement',
      content: 'Révisez par livre, chapitre et bloc de questions pour consolider vos bases.',
      position: 'bottom'
    },
    {
      id: 'step_simulation',
      targetId: 'module-simulation',
      title: 'Simulation',
      content: 'Mettez-vous en conditions réelles avec des auto-évaluations et des examens blancs.',
      position: 'bottom'
    },
    {
      id: 'step_planning',
      targetId: 'module-planning',
      title: 'Planification',
      content: 'Créez votre programme personnalisé pour ne jamais perdre le fil de vos révisions.',
      position: 'bottom'
    },
    {
      id: 'step_errors',
      targetId: 'module-errors',
      title: 'Mes erreurs',
      content: 'Le secret de la réussite : revenez sur vos erreurs pour ne plus jamais les refaire.',
      position: 'bottom'
    }
  ];

  const contextualSteps: Record<string, GuideStep> = {
    'simulation_config': {
      id: 'ctx_simulation',
      title: 'Configuration',
      content: 'Personnalisez votre épreuve : choisissez vos sources et définissez votre temps.',
      position: 'center'
    },
    'planning': {
      id: 'ctx_planning',
      title: 'Votre Programme',
      content: 'Définissez votre date d\'examen et votre rythme pour générer votre planning idéal.',
      position: 'center'
    },
    'exams': {
      id: 'ctx_exams',
      title: 'Examens Blancs',
      content: 'Participez aux évaluations nationales pour vous situer par rapport aux autres.',
      position: 'center'
    }
  };

  useEffect(() => {
    if (onboardingCompleted && currentView === 'dashboard') {
      const nextStep = dashboardSteps.find(step => !tutorialStepsCompleted.includes(step.id));
      if (nextStep) {
        setActiveTutorialStep(nextStep);
      } else {
        setActiveTutorialStep(null);
      }
    } else if (onboardingCompleted && contextualSteps[currentView] && !tutorialStepsCompleted.includes(contextualSteps[currentView].id)) {
      setActiveTutorialStep(contextualSteps[currentView]);
    } else {
      setActiveTutorialStep(null);
    }
  }, [onboardingCompleted, tutorialStepsCompleted, currentView]);

  useEffect(() => {
    if (activeTutorialStep?.targetId) {
      const updateRect = () => {
        const el = document.getElementById(activeTutorialStep.targetId!);
        if (el) {
          setHighlightRect(el.getBoundingClientRect());
        }
      };
      updateRect();
      window.addEventListener('resize', updateRect);
      return () => window.removeEventListener('resize', updateRect);
    } else {
      setHighlightRect(null);
    }
  }, [activeTutorialStep]);

  const handleNextOnboarding = () => {
    if (onboardingStep < onboardingScreens.length - 1) {
      setOnboardingStep(prev => prev + 1);
    } else {
      onCompleteOnboarding();
      setShowOnboarding(false);
    }
  };

  const handleNextTutorial = () => {
    if (activeTutorialStep) {
      onCompleteStep(activeTutorialStep.id);
    }
  };

  if (onboardingCompleted === null) return null;

  if (showOnboarding) {
    const screen = onboardingScreens[onboardingStep];
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-white p-4">
        <motion.div 
          key={onboardingStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="max-w-md w-full p-6 md:p-8 text-center space-y-6 md:space-y-8"
        >
          <div className={cn("w-24 h-24 md:w-32 md:h-32 mx-auto rounded-[2rem] md:rounded-[2.5rem] flex items-center justify-center shadow-xl shadow-gray-200/50", screen.color)}>
            {React.cloneElement(screen.icon as React.ReactElement, { className: "w-12 h-12 md:w-16 md:h-16" })}
          </div>
          <div className="space-y-3 md:space-y-4">
            <h2 className="text-2xl md:text-3xl font-display font-black text-gray-900 tracking-tight">{screen.title}</h2>
            <p className="text-gray-500 leading-relaxed text-base md:text-lg">{screen.content}</p>
          </div>
          <div className="flex flex-col gap-4">
            <button 
              onClick={handleNextOnboarding}
              className="w-full py-3.5 md:py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 group"
            >
              {onboardingStep === onboardingScreens.length - 1 ? "Commencer" : "Suivant"}
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <div className="flex justify-center gap-2">
              {onboardingScreens.map((_, i) => (
                <div key={i} className={cn("w-2 h-2 rounded-full transition-all", i === onboardingStep ? "w-6 bg-indigo-600" : "bg-gray-200")} />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (activeTutorialStep) {
    const isBottomHalf = highlightRect ? (highlightRect.top + highlightRect.height / 2) > window.innerHeight / 2 : false;

    return (
      <div className="fixed inset-0 z-[900] pointer-events-none">
        {/* Clickable overlay - only dark/blurred when no specific highlight is active */}
        <div 
          className={cn(
            "absolute inset-0 pointer-events-auto transition-all duration-500", 
            !highlightRect ? "bg-gray-900/40 backdrop-blur-[2px]" : "bg-transparent"
          )} 
          onClick={onSkipAll} 
        />
        
        {highlightRect && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: 1,
              top: highlightRect.top - 8,
              left: highlightRect.left - 8,
              width: highlightRect.width + 16,
              height: highlightRect.height + 16
            }}
            className="absolute bg-transparent rounded-[2rem] md:rounded-[2.5rem] shadow-[0_0_0_9999px_rgba(17,24,39,0.65)] z-[901] pointer-events-none border-4 border-indigo-500"
          >
            {/* Pulse effect for the hole */}
            <motion.div 
              animate={{ 
                scale: [1, 1.02, 1],
                opacity: [0.5, 0.8, 0.5]
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity,
                ease: "easeInOut" 
              }}
              className="absolute -inset-2 rounded-[2.2rem] md:rounded-[2.7rem] border-2 border-indigo-400/50"
            />
          </motion.div>
        )}

        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: isBottomHalf ? -20 : 20 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              y: 0,
              top: highlightRect 
                ? (isBottomHalf ? highlightRect.top - 24 : highlightRect.bottom + 24) 
                : '50%',
              left: '50%',
              translateX: '-50%',
              translateY: highlightRect ? (isBottomHalf ? '-100%' : '0') : '-50%'
            }}
            className="absolute z-[902] w-[calc(100vw-2rem)] max-w-sm bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl shadow-2xl border border-gray-100 pointer-events-auto"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-xl">
                  <Info className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="font-bold text-gray-900">{activeTutorialStep.title}</h3>
              </div>
              <button onClick={onSkipAll} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-gray-600 mb-6 leading-relaxed">{activeTutorialStep.content}</p>
            <div className="flex items-center justify-between">
              <button 
                onClick={onSkipAll}
                className="text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors"
              >
                Ignorer
              </button>
              <button 
                onClick={handleNextTutorial}
                className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
              >
                {tutorialStepsCompleted.length >= dashboardSteps.length - 1 && currentView === 'dashboard' ? "Terminer" : "Suivant"}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return null;
};
