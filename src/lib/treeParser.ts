export interface TreeNode {
  id: string;
  label: string;
  type: 'root' | 'trunk' | 'branch' | 'leaf';
  children?: TreeNode[];
}

export function parseMindMapText(text: string): TreeNode | null {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return null;

  // Symbols mapping to levels
  const symbolMap: Record<string, number> = {
    '#': 1,
    '>': 2,
    '-': 3,
    '*': 4
  };

  const root: TreeNode = {
    id: 'root',
    label: 'Carte Mentale',
    type: 'root',
    children: []
  };

  // Keep track of the last node at each level to attach children correctly
  const lastNodes: (TreeNode | null)[] = [root, null, null, null, null];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Regex to find the first valid symbol followed by a dot at the start of the line
    const match = line.match(/^([#>\-*])\.\s*(.*)/);
    if (!match) continue; // Ignore lines without a valid symbol + dot pattern

    const symbol = match[1];
    const content = match[2].trim();
    if (!content) continue;

    const level = symbolMap[symbol];
    if (!level) continue;

    const nodeTypeMap: Record<number, TreeNode['type']> = {
      1: 'trunk',
      2: 'branch',
      3: 'branch',
      4: 'leaf'
    };

    const newNode: TreeNode = {
      id: `node-${i}-${Math.random().toString(36).substr(2, 5)}`,
      label: content,
      type: nodeTypeMap[level] || 'leaf',
      children: []
    };

    // Find the appropriate parent
    // Level 1 parent is lastNodes[0] (root)
    // Level 2 parent is lastNodes[1] (last Level 1)
    // ...
    let parentFound = false;
    for (let k = level - 1; k >= 0; k--) {
      if (lastNodes[k]) {
        if (!lastNodes[k]!.children) lastNodes[k]!.children = [];
        lastNodes[k]!.children!.push(newNode);
        lastNodes[level] = newNode;
        
        // Reset deeper levels to ensure a clean branch state
        for (let j = level + 1; j < lastNodes.length; j++) {
          lastNodes[j] = null;
        }
        parentFound = true;
        break;
      }
    }
  }

  // Final check: If root has only one Level 1 child, we can promote that child's label to the root and use its children
  // This makes the mind map look better by having a specific topic at the center.
  if (root.children && root.children.length === 1 && root.label === 'Carte Mentale') {
    const singleChild = root.children[0];
    root.label = singleChild.label;
    root.children = singleChild.children || [];
    // We keep the root ID as 'root' but update its content.
  }

  return root;
}
