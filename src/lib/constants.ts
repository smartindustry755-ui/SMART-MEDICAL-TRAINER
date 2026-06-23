export const FILIERES = [
  { id: 'ECN', name: 'ECN (Médecine)', levels: ['ALL', 'D1', 'D2', 'D3', 'D4'] },
  { id: 'IDE', name: 'IDE (Infirmier)', levels: ['ALL', 'Niveau 1', 'Niveau 2', 'Niveau 3'] },
  { id: 'EM', name: 'EM (Études Médicales)', levels: ['ALL', 'Niveau 1', 'Niveau 2', 'Niveau 3', 'Niveau 4', 'Niveau 5', 'Niveau 6'] },
  { id: 'ALL', name: 'Toutes filières', levels: ['ALL'] }
];

export const FILIERE_OPTIONS = FILIERES.map(f => ({ id: f.id, name: f.name }));

export function getLevelsForFiliere(filiereId: string) {
  const f = FILIERES.find(f => f.id === filiereId);
  return f ? f.levels : ['ALL'];
}
