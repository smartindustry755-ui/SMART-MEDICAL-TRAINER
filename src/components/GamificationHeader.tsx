import React, { useState, useRef, useEffect } from 'react';
import { Bell, CheckCircle2, HelpCircle, LogIn } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface GamificationHeaderProps {
  userProgress: any;
  plans: any[];
  lastExamRank?: number | null;
  onLogout?: () => void;
  onRestartTutorial?: () => void;
  isDemo?: boolean;
}

export const GamificationHeader = ({ userProgress, plans, lastExamRank, onLogout, onRestartTutorial, isDemo }: GamificationHeaderProps) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!userProgress) return null;

  const today = new Date().toISOString().split('T')[0];
  const pendingPlans = plans.filter(p => {
    const dailyDone = p.progress?.dailyProgress?.[today] || 0;
    return dailyDone < p.questionsPerDay;
  });

  return (
    <div className="flex items-center justify-end relative gap-2">
      {isDemo && onLogout && (
        <button 
          onClick={onLogout}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-lg shadow-blue-200 transition-all active:scale-95 group"
          title="Se connecter avec un compte"
        >
          <LogIn className="w-5 h-5" />
          <span className="text-xs font-black">S'authentifier</span>
        </button>
      )}
      {onRestartTutorial && (
        <button 
          onClick={onRestartTutorial}
          className="flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-indigo-50 rounded-2xl border border-gray-200 shadow-sm transition-all active:scale-95 group"
          title="Revoir le guide d'utilisation"
        >
          <HelpCircle className="w-5 h-5 text-gray-600 group-hover:text-indigo-600 transition-colors" />
          <span className="text-xs font-bold text-gray-500 group-hover:text-indigo-600 hidden sm:block">Guide</span>
        </button>
      )}
      <div className="relative" ref={dropdownRef}>
        <button 
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative p-2.5 bg-white hover:bg-gray-50 rounded-2xl border border-gray-200 shadow-sm transition-all active:scale-95 group"
        >
          <Bell className="w-5 h-5 text-gray-600 group-hover:text-indigo-600 transition-colors" />
          {pendingPlans.length > 0 && (
            <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
          )}
        </button>
        
        <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50"
              >
                <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                  <h4 className="font-bold text-gray-900">Notifications</h4>
                  <span className="text-xs font-bold bg-gray-200 text-gray-600 px-2 py-1 rounded-full">{pendingPlans.length}</span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {pendingPlans.length > 0 ? (
                    pendingPlans.map(plan => (
                      <div key={plan.id} className="p-4 border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="mt-1 p-1.5 bg-blue-50 rounded-lg">
                            <Bell className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900 mb-1">Objectif quotidien incomplet</p>
                            <p className="text-xs text-gray-500 leading-relaxed">
                              Il vous reste {plan.questionsPerDay - (plan.progress?.dailyProgress?.[today] || 0)} QCM à faire pour "{plan.title}".
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-gray-500">
                      <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
                      <p className="text-sm font-medium">Tous vos objectifs du jour sont atteints !</p>
                    </div>
                  )}
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-100 text-center">
                  <button 
                    onClick={() => setShowNotifications(false)}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Fermer
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
      </div>
    </div>
  );
};
