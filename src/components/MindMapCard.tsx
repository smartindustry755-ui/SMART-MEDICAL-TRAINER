import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ArrowLeft, GitBranch, Layout, Layers, Leaf, Eye, EyeOff, Expand, Shrink } from 'lucide-react';
import { TreeNode } from '../lib/treeParser';
import { cn } from '../lib/utils';

interface MindMapCardProps {
  tree: TreeNode;
  onBack?: () => void;
}

interface TreeNodeViewProps {
  node: TreeNode;
  expandedNodes: Set<string>;
  toggleNode: (id: string) => void;
  showLeaves: boolean;
}

const TreeNodeView: React.FC<TreeNodeViewProps> = ({ 
  node, 
  expandedNodes, 
  toggleNode, 
  showLeaves 
}) => {
  if (node.type === 'leaf' && !showLeaves) return null;

  const visibleChildren = (node.children || []).filter(c => showLeaves || c.type !== 'leaf');
  const actuallyHasChildren = visibleChildren.length > 0;
  const isExpanded = expandedNodes.has(node.id);

  return (
    <div className="flex flex-col mt-3 w-full">
      <div 
        onClick={() => actuallyHasChildren && toggleNode(node.id)}
        className={cn(
          "flex items-center justify-between p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all w-full select-none relative overflow-hidden",
          actuallyHasChildren ? "cursor-pointer hover:shadow-md" : "",
          node.type === 'root' ? "bg-indigo-600 border-indigo-500 text-white shadow-lg" :
          node.type === 'trunk' ? "bg-emerald-50 border-emerald-200 text-emerald-950 hover:border-emerald-400" :
          node.type === 'branch' ? "bg-blue-50 border-blue-200 text-blue-950 hover:border-blue-400" :
          "bg-white border-gray-200 text-gray-800 hover:border-gray-300"
        )}
      >
        {node.type === 'root' && <div className="absolute top-0 right-0 w-24 h-24 sm:w-32 sm:h-32 bg-white/10 rounded-full blur-2xl sm:blur-3xl -translate-y-1/2 translate-x-1/2" />}
        
        <div className="flex items-center gap-3 sm:gap-4 relative z-10 w-full pr-2">
          <div className={cn(
            "p-2 sm:p-3 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0",
            node.type === 'root' ? "bg-white/20 text-white" :
            node.type === 'trunk' ? "bg-emerald-200 text-emerald-700" :
            node.type === 'branch' ? "bg-blue-200 text-blue-700" :
            "bg-gray-100 text-gray-500"
          )}>
            {node.type === 'root' && <GitBranch className="w-5 h-5 sm:w-6 sm:h-6" />}
            {node.type === 'trunk' && <Layout className="w-4 h-4 sm:w-5 sm:h-5" />}
            {node.type === 'branch' && <Layers className="w-4 h-4 sm:w-5 sm:h-5" />}
            {node.type === 'leaf' && <Leaf className="w-4 h-4 sm:w-5 sm:h-5" />}
          </div>
          <div className="flex flex-col text-left">
            <span className={cn(
              "text-[9px] sm:text-[10px] font-black uppercase tracking-wider sm:tracking-widest",
              node.type === 'root' ? "text-indigo-200" : "text-gray-400"
            )}>
              {node.type === 'root' ? 'Matière / Chapitre' : 
               node.type === 'trunk' ? 'Tronc' : 
               node.type === 'branch' ? 'Branche' : 'Point clé'}
            </span>
            <span className={cn(
              "font-bold leading-tight",
              node.type === 'root' ? "text-lg sm:text-2xl" : "text-sm sm:text-lg"
            )}>
              {node.label}
            </span>
          </div>
        </div>
        
        {actuallyHasChildren && (
          <div className="flex items-center gap-2 sm:gap-3 relative z-10 shrink-0">
            <span className={cn(
              "text-[10px] sm:text-xs font-bold px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md",
              node.type === 'root' ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
            )}>
              {visibleChildren.length}
            </span>
            <div className={cn(
              "transform transition-transform duration-300",
              isExpanded ? "rotate-90" : "rotate-0"
            )}>
              <ChevronRight className={cn(
                "w-5 h-5 sm:w-6 sm:h-6",
                node.type === 'root' ? "text-white/70" : "text-gray-400"
              )} />
            </div>
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && actuallyHasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pl-3 sm:pl-6 md:pl-10 ml-3 sm:ml-6 md:ml-8 border-l-2 border-indigo-100/50 pb-2">
              {visibleChildren.map(child => (
                <TreeNodeView 
                  key={child.id} 
                  node={child} 
                  expandedNodes={expandedNodes} 
                  toggleNode={toggleNode} 
                  showLeaves={showLeaves} 
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function MindMapCard({ tree, onBack }: MindMapCardProps) {
  const [showLeaves, setShowLeaves] = useState(true);
  
  // By default, expand the root
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set([tree.id]));

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const expandAll = (node: TreeNode) => {
    const allIds: string[] = [];
    const traverse = (n: TreeNode) => {
      // Only expand if it has children and they are not just hidden leaves
      const visibleChildren = (n.children || []).filter(c => showLeaves || c.type !== 'leaf');
      if (visibleChildren.length > 0) {
        allIds.push(n.id);
        n.children?.forEach(traverse);
      }
    };
    traverse(node);
    setExpandedNodes(new Set(allIds));
  };

  const collapseAll = () => {
    setExpandedNodes(new Set([tree.id]));
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      {/* Header / Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white p-3 sm:p-4 rounded-2xl border border-gray-100 shadow-sm gap-3 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <button 
            onClick={onBack}
            className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500"
          >
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="flex flex-col">
            <span className="text-xs sm:text-sm font-bold text-gray-900">Carte Mentale</span>
            <span className="text-[10px] sm:text-xs text-gray-500">Vue interactive</span>
          </div>
        </div>

        <div className="flex flex-row items-center gap-2 w-full sm:w-auto">
          <button 
            onClick={() => {
              if (expandedNodes.size > 1) {
                collapseAll();
              } else {
                expandAll(tree);
              }
            }}
            className="flex-1 sm:flex-none justify-center px-2 py-1.5 sm:px-3 sm:py-2 bg-gray-50 hover:bg-gray-100 rounded-xl transition-all flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-sm font-bold text-gray-600"
          >
            {expandedNodes.size > 1 ? (
              <><Shrink className="w-3 h-3 sm:w-4 sm:h-4" /> Réduire tout</>
            ) : (
              <><Expand className="w-3 h-3 sm:w-4 sm:h-4" /> Tout déplier</>
            )}
          </button>
          <button 
            onClick={() => setShowLeaves(!showLeaves)}
            className={cn(
              "flex-1 sm:flex-none justify-center px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl transition-all flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-sm font-bold",
              showLeaves ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100" : "bg-gray-50 text-gray-500 hover:bg-gray-100"
            )}
            title={showLeaves ? "Masquer les feuilles (Mode Apprentissage)" : "Afficher les feuilles"}
          >
            {showLeaves ? <Eye className="w-3 h-3 sm:w-4 sm:h-4" /> : <EyeOff className="w-3 h-3 sm:w-4 sm:h-4" />}
            <span className="truncate">{showLeaves ? "Feuilles" : "Épuré"}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: The Tree */}
      <div className="bg-white/50 backdrop-blur-sm p-2 sm:p-4 md:p-8 rounded-3xl md:rounded-[2.5rem] border border-gray-100 shadow-xl overflow-hidden min-h-[500px]">
        <TreeNodeView 
          node={tree} 
          expandedNodes={expandedNodes} 
          toggleNode={toggleNode} 
          showLeaves={showLeaves} 
        />
      </div>

      {/* Progress Footer */}
      <div className="bg-white p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gray-100 shadow-sm flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-gray-400">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-indigo-500" /> Racine
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-emerald-500" /> Tronc
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-blue-500" /> Branche
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gray-200" /> Feuille
        </div>
      </div>
    </div>
  );
}
