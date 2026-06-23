export interface ParsedQuestion {
  number: number;
  text: string;
  type?: 'QCM' | 'QROC' | 'VRAI_FAUX' | 'TAB';
  options: { letter: string; text: string }[];
  sharedStem?: string;
  isGrouped?: boolean;
  groupTitle?: string;
  groupId?: string;
}

export interface ParsedAnswer {
  number: number;
  correctLetter: string;
  correctLetters: string[];
  expectedAnswer?: string;
  explanation: string;
}

export function parseLangeQuestions(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  
  // Split by question number OR group header
  const blocks = normalizedText.split(/\n(?=\d+\.|Questions?\s+\d+)/m).filter(b => b.trim());
  
  let currentGroup: { title: string; stem: string; options: { letter: string; text: string }[]; range: number[] } | null = null;

  for (let block of blocks) {
    block = block.trim();
    const lines = block.split('\n');
    const firstLine = lines[0].trim();

    // Check for Group Header: "Questions 43 à 48" or "Questions 14 et 15"
    const groupMatch = firstLine.match(/^Questions?\s+(\d+)\s*(?:à|et|[-–—])\s*(\d+)/i);
    if (groupMatch) {
      const start = parseInt(groupMatch[1]);
      const end = parseInt(groupMatch[2]);
      const range = [];
      for (let i = start; i <= end; i++) range.push(i);

      let stem = '';
      const options: { letter: string; text: string }[] = [];
      let currentPart: 'stem' | 'options' = 'stem';

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Check if we hit a question number like "14."
        if (line.match(/^\d+\./)) break;

        const optionMatch = line.match(/^\(([A-K])\)\s*(.*)/i);
        if (optionMatch) {
          currentPart = 'options';
          options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2] });
        } else if (currentPart === 'stem') {
          stem += line + ' ';
        } else if (currentPart === 'options' && options.length > 0) {
          options[options.length - 1].text += ' ' + line;
        }
      }
      currentGroup = { title: firstLine, stem: stem.trim(), options: options.map(o => ({ ...o, text: o.text.trim() })), range };
      continue;
    }

    // Individual Question
    const matchNum = firstLine.match(/^(\d+)\./);
    if (!matchNum) continue;

    const number = parseInt(matchNum[1]);
    let questionText = '';
    const options: { letter: string; text: string }[] = [];
    let currentPart: 'text' | 'options' = 'text';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const optionMatch = line.match(/^\(([A-K])\)\s*(.*)/i);
      if (optionMatch) {
        currentPart = 'options';
        options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2] });
      } else if (currentPart === 'text') {
        if (i === 0) {
          questionText += line.replace(/^\d+\.\s*/, '') + ' ';
        } else {
          questionText += line + ' ';
        }
      } else if (currentPart === 'options' && options.length > 0) {
        options[options.length - 1].text += ' ' + line;
      }
    }

    // Check if this question belongs to the current group
    if (currentGroup && currentGroup.range.includes(number)) {
      questions.push({
        number,
        text: questionText.trim(),
        type: 'QCM',
        options: options.length > 0 ? options.map(o => ({ ...o, text: o.text.trim() })) : currentGroup.options,
        sharedStem: currentGroup.stem,
        isGrouped: true,
        groupTitle: currentGroup.title
      });
    } else {
      // Not in a group or group ended
      questions.push({
        number,
        text: questionText.trim(),
        type: 'QCM',
        options: options.map(o => ({ ...o, text: o.text.trim() }))
      });
    }
  }

  return questions;
}

export function parseLangeAnswers(text: string): ParsedAnswer[] {
  const answers: ParsedAnswer[] = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  
  // Split by number at start of line (could be "1.", "49 à 53.", "97(B)", or "Questions 97-99")
  const blocks = normalizedText.split(/\n(?=\d+(?:\s*(?:à|-|–)\s*\d+)?\.|(?:\d+\s*\()|Questions?\s+\d+)/m).filter(b => b.trim());

  for (let block of blocks) {
    block = block.trim();
    const lines = block.split('\n');
    const firstLine = lines[0].trim();

    // Case 1: Simple Answer "1. (C) ..." or "1. (A, B) ..."
    const simpleMatch = firstLine.match(/^(\d+)\.\s*\(([^)]+)\)\s*(.*)/i);
    if (simpleMatch) {
      const number = parseInt(simpleMatch[1]);
      const lettersStr = simpleMatch[2];
      const correctLetters = lettersStr.split(',').map(l => l.trim().toUpperCase());
      const explanation = (simpleMatch[3] + ' ' + lines.slice(1).join(' ')).trim();
      answers.push({ 
        number, 
        correctLetters, 
        correctLetter: correctLetters.join(', '), 
        explanation 
      });
      continue;
    }

    // Case 2: Grouped Answers "49 à 53. Les réponses sont 49-a, 50-c..."
    const groupedMatch = firstLine.match(/^(\d+)\s+(?:à|-|–)\s+(\d+)\.\s*Les réponses sont\s+(.*)/i);
    if (groupedMatch) {
      const answerPart = groupedMatch[3];
      const explanation = lines.slice(1).join(' ').trim();
      
      // Extract all pairs like "49-a" or "49-(C)" or "49-(A, B)"
      const pairs = answerPart.matchAll(/(\d+)-([a-z]|\([a-z, ]+\))/gi);
      for (const pair of pairs) {
        let letterPart = pair[2].toUpperCase().replace(/[()]/g, '');
        const letters = letterPart.split(',').map(l => l.trim());
        answers.push({
          number: parseInt(pair[1]),
          correctLetters: letters,
          correctLetter: letters.join(', '),
          explanation: explanation // Shared explanation
        });
      }
      continue;
    }

    // NEW Case: Lange Grouped Answers with range "40–43. (40-A, 41-C...)" or "23-27. 23-(A)..."
    const rangeMatch = firstLine.match(/^(\d+)\s*[–-]\s*(\d+)\.\s*(.*)/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      const content = (rangeMatch[3] + ' ' + lines.slice(1).join(' ')).trim().replace(/–/g, '-');
      
      const mapping: Record<number, string> = {};
      
      // Extract pairs: (\d+)\s*-\s*([A-Z])
      const matches1 = content.matchAll(/(\d+)\s*-\s*([A-Z])(?![A-Z0-9])/gi);
      for (const m of matches1) {
        const num = parseInt(m[1]);
        if (num >= start && num <= end) mapping[num] = m[2].toUpperCase();
      }
      
      // Extract pairs: (\d+)\s*-\s*\(([A-Z])\)/gi
      const matches2 = content.matchAll(/(\d+)\s*-\s*\(([A-Z])\)/gi);
      for (const m of matches2) {
        const num = parseInt(m[1]);
        if (num >= start && num <= end) mapping[num] = m[2].toUpperCase();
      }

      if (Object.keys(mapping).length > 0) {
        for (const [numStr, letter] of Object.entries(mapping)) {
          answers.push({
            number: parseInt(numStr),
            correctLetters: [letter],
            correctLetter: letter,
            explanation: content
          });
        }
        continue;
      }
    }

    // Case 3: Lange Grouped Answers "97(B), 98(C), 99(D)"
    const langeGroupedMatches = Array.from(block.matchAll(/(\d+)\s*\(\s*([A-Z,\s]+)\s*\)/gi));
    if (langeGroupedMatches.length > 0) {
      // If multiple matches, or if it starts with a match (even if only one, but Case 1 failed)
      if (langeGroupedMatches.length > 1 || block.startsWith(langeGroupedMatches[0][0])) {
        for (const match of langeGroupedMatches) {
          const number = parseInt(match[1]);
          const lettersStr = match[2];
          const correctLetters = lettersStr.split(',').map(l => l.trim().toUpperCase());
          answers.push({
            number,
            correctLetters,
            correctLetter: correctLetters.join(', '),
            explanation: block.trim()
          });
        }
        continue;
      }
    }
  }
  return answers;
}

export function parsePreTestQuestions(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  
  // Split by question number OR group header
  const blocks = normalizedText.split(/\n(?=\d+\.|Questions?\s+\d+)/m).filter(b => b.trim());
  
  let currentGroup: { title: string; stem: string; options: { letter: string; text: string }[]; range: number[] } | null = null;

  for (let block of blocks) {
    block = block.trim();
    const lines = block.split('\n');
    const firstLine = lines[0].trim();

    // Check for Group Header: "Questions 43 à 48" or "Questions 14 et 15"
    const groupMatch = firstLine.match(/^Questions?\s+(\d+)\s*(?:à|et|[-–—])\s*(\d+)/i);
    if (groupMatch) {
      const start = parseInt(groupMatch[1]);
      const end = parseInt(groupMatch[2]);
      const range = [];
      for (let i = start; i <= end; i++) range.push(i);

      let stem = '';
      const options: { letter: string; text: string }[] = [];
      let currentPart: 'stem' | 'options' = 'stem';

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const optionMatch = line.match(/^([A-K])\.\s*(.*)/i);
        if (optionMatch) {
          currentPart = 'options';
          options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2] });
        } else if (currentPart === 'stem') {
          stem += line + ' ';
        } else if (currentPart === 'options' && options.length > 0) {
          options[options.length - 1].text += ' ' + line;
        }
      }
      currentGroup = { title: firstLine, stem: stem.trim(), options: options.map(o => ({ ...o, text: o.text.trim() })), range };
      continue;
    }

    // Individual Question
    const matchNum = firstLine.match(/^(\d+)\./);
    if (!matchNum) continue;

    const number = parseInt(matchNum[1]);
    let questionText = '';
    const options: { letter: string; text: string }[] = [];
    let currentPart: 'text' | 'options' = 'text';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const optionMatch = line.match(/^([A-K])\.\s*(.*)/i);
      if (optionMatch) {
        currentPart = 'options';
        options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2] });
      } else if (currentPart === 'text') {
        if (i === 0) {
          questionText += line.replace(/^\d+\.\s*/, '') + ' ';
        } else {
          questionText += line + ' ';
        }
      } else if (currentPart === 'options' && options.length > 0) {
        options[options.length - 1].text += ' ' + line;
      }
    }

    // Check if this question belongs to the current group
    if (currentGroup && currentGroup.range.includes(number)) {
      questions.push({
        number,
        text: questionText.trim(),
        options: options.length > 0 ? options.map(o => ({ ...o, text: o.text.trim() })) : currentGroup.options,
        sharedStem: currentGroup.stem,
        isGrouped: true,
        groupTitle: currentGroup.title
      });
    } else {
      // Not in a group or group ended
      questions.push({
        number,
        text: questionText.trim(),
        options: options.map(o => ({ ...o, text: o.text.trim() }))
      });
    }
  }
  return questions;
}

export function parsePreTestAnswers(text: string): ParsedAnswer[] {
  const answers: ParsedAnswer[] = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  
  // Split by number at start of line (could be "1.", "49 à 53.", or "164-167.")
  const blocks = normalizedText.split(/\n(?=\d+(?:\s*(?:à|-)\s*\d+)?\.)/m).filter(b => b.trim());

  for (let block of blocks) {
    block = block.trim();
    const lines = block.split('\n');
    const firstLine = lines[0].trim();

    // Case 1: Simple Answer "1. La réponse est e."
    // Support "La réponse est a., c., d.", "Les bonnes réponses sont a, b", etc.
    const simpleMatch = firstLine.match(/^(\d+)\.\s*(?:La (?:bonne )?réponse est|Les (?:bonnes )?réponses sont|La réponse est)\s+([A-Za-z,\s.]+?)(?:\s*\(|\s*\.\s+|$)/i);
    if (simpleMatch) {
      const number = parseInt(simpleMatch[1]);
      const lettersPart = simpleMatch[2].toUpperCase();
      // Split by comma, space or dot to get letters like "A. B, C."
      const correctLetters = lettersPart.split(/[\s,.]+/).map(l => l.trim()).filter(l => l.length === 1 && l >= 'A' && l <= 'K');
      
      const headerLength = simpleMatch[0].length;
      const fullExplanation = block.substring(headerLength).trim();

      answers.push({ 
        number, 
        correctLetters, 
        correctLetter: correctLetters.join(', '), 
        explanation: fullExplanation 
      });
      continue;
    }

    // Case 3: QROC or Direct Answer like "1. Une inflammation."
    const qrocMatch = firstLine.match(/^(\d+)\.\s+(.*)/i);
    if (qrocMatch) {
      const number = parseInt(qrocMatch[1]);
      const content = qrocMatch[2];
      let expectedAnswer = content;
      let explanation = lines.slice(1).join(' ').trim();
      
      // If it's Vrai or Faux:
      let correctLetter = '';
      if (content.toLowerCase().startsWith('vrai')) {
        correctLetter = 'A';
        expectedAnswer = 'Vrai';
      } else if (content.toLowerCase().startsWith('faux')) {
        correctLetter = 'B';
        expectedAnswer = 'Faux';
      }

      answers.push({
        number,
        correctLetter,
        correctLetters: correctLetter ? [correctLetter] : [],
        expectedAnswer,
        explanation: content + ' ' + explanation
      });
      continue;
    }

    // Case 2: Grouped Answers "49 à 53. Les réponses sont 49-a, 50-c..." or "164-167. Les réponses sont..."
    const groupedMatch = firstLine.match(/^(\d+)\s*(?:à|-)\s*(\d+)\.\s*Les réponses sont/i);
    if (groupedMatch) {
      const start = parseInt(groupedMatch[1]);
      const end = parseInt(groupedMatch[2]);
      
      const explanation = block.replace(/^(\d+)\s*(?:à|-)\s*(\d+)\.\s*Les réponses sont/i, '').trim();
      
      // Extract all pairs like "49-a" or "49-(C)" or "164 - a"
      const pairs = block.matchAll(/(\d+)\s*-\s*([a-z](?:\s*,\s*[a-z])*|\([a-z](?:\s*,\s*[a-z])*\))/gi);
      for (const pair of pairs) {
        const num = parseInt(pair[1]);
        if (num >= start && num <= end) {
          let letterPart = pair[2].toUpperCase().replace(/[()]/g, '');
          const letters = letterPart.split(',').map(l => l.trim());
          answers.push({
            number: num,
            correctLetters: letters,
            correctLetter: letters.join(', '),
            explanation: explanation // Shared explanation
          });
        }
      }
      continue;
    }
    
    // Fallback for English format or previous logic
    const fallbackMatch = firstLine.match(/^(\d+)\.\s*The answer is\s*([A-Z, ]+)\.?\s*(.*)/is);
    if (fallbackMatch) {
      const lettersStr = fallbackMatch[2].toUpperCase().replace(/[()]/g, '');
      const letters = lettersStr.split(',').map(l => l.trim());
      answers.push({
        number: parseInt(fallbackMatch[1]),
        correctLetters: letters,
        correctLetter: letters.join(', '),
        explanation: (fallbackMatch[3] + ' ' + lines.slice(1).join(' ')).trim()
      });
    }
  }
  return answers;
}

export function parseMinsanteQuestions(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  
  // Split by question number or context markers (handles e.g. "1.", "1[VF].", "1[QROC].", [CAS], [CAS_CLINIQUE], etc.)
  const blocks = normalizedText.split(/\n(?=\d+(?:\[[^\]]+\])?\.|\s*\[(?:CAS|CAS_CLINIQUE|ETUDE_DE_CAS|SITUATION|CONTEXTE)\])/mi).filter(b => b.trim());
  
  let activeSharedStem: string | null = null;
  let activeGroupTitle: string | null = null;
  let activeGroupId: string | null = null;

  for (let block of blocks) {
    block = block.trim();
    
    // Check if block contains any of the context markers before the first question starts
    const markerMatch = block.match(/^\[(CAS|CAS_CLINIQUE|ETUDE_DE_CAS|SITUATION|CONTEXTE)\]/i);
    if (markerMatch) {
      const markerType = markerMatch[1].toUpperCase();
      let groupTitle = 'CAS CLINIQUE';
      if (markerType === 'ETUDE_DE_CAS') {
        groupTitle = 'ÉTUDE DE CAS';
      } else if (markerType === 'SITUATION') {
        groupTitle = 'SITUATION PRATIQUE';
      } else if (markerType === 'CONTEXTE') {
        groupTitle = 'CONTEXTE';
      }
      
      // Extract the shared context text that is between the marker and the question header
      const questionIndex = block.search(/\n\d+(?:\[[^\]]+\])?\./);
      if (questionIndex !== -1) {
        const afterMarker = block.substring(markerMatch[0].length, questionIndex).trim();
        activeSharedStem = afterMarker;
        activeGroupTitle = groupTitle;
        activeGroupId = `group_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        // Trim block to only contain the question starting from the question header
        block = block.substring(questionIndex).trim();
      } else {
        // No question found in this block? Could be a dangling context block (though rare)
        activeSharedStem = block.substring(markerMatch[0].length).trim();
        activeGroupTitle = groupTitle;
        activeGroupId = `group_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        continue;
      }
    }
    
    const lines = block.split('\n');
    const firstLine = lines[0].trim();
    
    // Parse question number and type tag
    const matchHeader = firstLine.match(/^(\d+)\s*(?:\[([^\]]+)\])?\s*\.\s*(.*)/i);
    if (!matchHeader) continue;
    
    const number = parseInt(matchHeader[1]);
    const tag = (matchHeader[2] || '').toUpperCase();
    
    let type: 'QCM' | 'VRAI_FAUX' | 'QROC' | 'TAB' = 'QCM';
    if (tag === 'VF' || tag === 'VRAI_FAUX') {
      type = 'VRAI_FAUX';
    } else if (tag === 'QROC') {
      type = 'QROC';
    } else if (tag === 'TAB') {
      type = 'TAB';
    }

    let questionText = matchHeader[3] + ' ';
    const options: { letter: string; text: string }[] = [];
    let currentPart: 'text' | 'options' = 'text';

    // Parse options
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Check if we hit a context marker inside the block to stop appending to the current question
      if (line.match(/^\[(CAS|CAS_CLINIQUE|ETUDE_DE_CAS|SITUATION|CONTEXTE)\]/i)) {
        break;
      }

      const optionMatch = line.match(/^([A-K])\.\s*(.*)/i);
      if (optionMatch) {
        currentPart = 'options';
        options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2] });
      } else if (currentPart === 'text') {
        questionText += line + ' ';
      } else if (currentPart === 'options' && options.length > 0) {
        options[options.length - 1].text += ' ' + line;
      }
    }

    // Default options for VRAI_FAUX if none were parsed
    let finalOptions = options.map(o => ({ ...o, text: o.text.trim() }));
    if (type === 'VRAI_FAUX' && finalOptions.length === 0) {
      finalOptions = [
        { letter: 'A', text: 'Vrai' },
        { letter: 'B', text: 'Faux' }
      ];
    }

    questions.push({
      number,
      text: questionText.trim(),
      type,
      options: finalOptions,
      isGrouped: activeSharedStem ? true : false,
      groupTitle: activeSharedStem ? activeGroupTitle! : undefined,
      sharedStem: activeSharedStem ? activeSharedStem : undefined,
      groupId: activeSharedStem ? activeGroupId! : undefined,
    });
  }
  return questions;
}

export function parseMinsanteAnswers(text: string): ParsedAnswer[] {
  const answers: ParsedAnswer[] = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  
  const blocks = normalizedText.split(/\n(?=\d+(?:\[[^\]]+\])?\.|\s*\[(?:CAS|CAS_CLINIQUE|ETUDE_DE_CAS|SITUATION|CONTEXTE)\])/mi).filter(b => b.trim());

  for (let block of blocks) {
    block = block.trim();
    if (block.match(/^\[(CAS|CAS_CLINIQUE|ETUDE_DE_CAS|SITUATION|CONTEXTE)\]/i)) {
      continue; // Skip context blocks in answers
    }
    const lines = block.split('\n');
    const firstLine = lines[0].trim();

    const matchHeader = firstLine.match(/^(\d+)\s*(?:\[([^\]]+)\])?\s*\.\s*(.*)/i);
    if (!matchHeader) continue;

    const number = parseInt(matchHeader[1]);
    const tag = (matchHeader[2] || '').toUpperCase();
    const content = matchHeader[3];

    let type: 'QCM' | 'VRAI_FAUX' | 'QROC' | 'TAB' = 'QCM';
    if (tag === 'VF' || tag === 'VRAI_FAUX') {
      type = 'VRAI_FAUX';
    } else if (tag === 'QROC') {
      type = 'QROC';
    } else if (tag === 'TAB') {
      type = 'TAB';
    }

    if (type === 'VRAI_FAUX') {
      let expectedAnswer = 'Vrai';
      let correctLetter = 'A';
      
      const answerLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.match(/^\[(CAS|CAS_CLINIQUE|ETUDE_DE_CAS|SITUATION|CONTEXTE)\]/i)) {
          break;
        }
        answerLines.push(lines[i]);
      }
      
      const fullText = (content + ' ' + answerLines.join(' ')).trim();
      const lowerText = fullText.toLowerCase();
      let isFaux = false;

      // Check for explicit "la réponse est ..." or direct formula
      const responseMatch = lowerText.match(/(?:la\s+réponse\s+est|réponse\s*:|bonne\s+réponse\s*:)\s*(vrai|faux|true|false|a|b)/i);
      if (responseMatch) {
        const matchedAns = responseMatch[1].toLowerCase();
        if (matchedAns === 'faux' || matchedAns === 'false' || matchedAns === 'b') {
          isFaux = true;
        }
      } else {
        // Fallback: examine first sentence or first 60 chars of explanation
        const firstSentence = lowerText.split(/[.!?\n]/)[0];
        if (firstSentence.includes('faux') || firstSentence.includes('false')) {
          isFaux = true;
        } else if (firstSentence.includes('vrai') || firstSentence.includes('true')) {
          isFaux = false;
        } else {
          const startClip = lowerText.substring(0, 60);
          if (startClip.includes('faux')) {
            isFaux = true;
          }
        }
      }

      if (isFaux) {
        expectedAnswer = 'Faux';
        correctLetter = 'B';
      } else {
        expectedAnswer = 'Vrai';
        correctLetter = 'A';
      }
      
      answers.push({
        number,
        correctLetter,
        correctLetters: [correctLetter],
        expectedAnswer,
        explanation: fullText
      });
      continue;
    }

    if (type === 'QROC') {
      const answerLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.match(/^\[(CAS|CAS_CLINIQUE|ETUDE_DE_CAS|SITUATION|CONTEXTE)\]/i)) {
          break;
        }
        answerLines.push(lines[i]);
      }
      const fullText = (content + ' ' + answerLines.join(' ')).trim();
      answers.push({
        number,
        correctLetter: '',
        correctLetters: [],
        expectedAnswer: fullText,
        explanation: fullText
      });
      continue;
    }

    // Default is QCM, parse like PreTest Simple Answer first: "1. La réponse est e."
    const simpleMatch = firstLine.match(/^(\d+)\.\s*(?:La (?:bonne )?réponse est|Les (?:bonnes )?réponses sont|La réponse est)\s+([A-Za-z,\s.]+?)(\s*\(|\s*\.\s+|$)/i);
    if (simpleMatch) {
      const lettersPart = simpleMatch[2].toUpperCase();
      const correctLetters = lettersPart.split(/[\s,.]+/).map(l => l.trim()).filter(l => l.length === 1 && l >= 'A' && l <= 'K');
      
      const headerLength = simpleMatch[0].length;
      const fullExplanation = block.substring(headerLength).trim();

      answers.push({ 
        number, 
        correctLetters, 
        correctLetter: correctLetters.join(', '), 
        explanation: fullExplanation 
      });
      continue;
    }

    // fallback if no "La réponse est ..." is specified, but it starts with "1. A" or similar
    const letterMatch = content.match(/^([A-K])\b(?:\s*\.|\s*,|\s*$)/i);
    if (letterMatch) {
      const correctLetter = letterMatch[1].toUpperCase();
      const explanation = (content.substring(letterMatch[0].length) + ' ' + lines.slice(1).join(' ')).trim();
      answers.push({
        number,
        correctLetter,
        correctLetters: [correctLetter],
        explanation: explanation || `La réponse correcte est ${correctLetter}.`
      });
      continue;
    }

    // Otherwise, fallback to QROC-like direct answers
    answers.push({
      number,
      correctLetter: '',
      correctLetters: [],
      expectedAnswer: content,
      explanation: (content + ' ' + lines.slice(1).join(' ')).trim()
    });
  }
  return answers;
}

export function normalizeParsedData(questions: ParsedQuestion[], answers: ParsedAnswer[]): { questions: ParsedQuestion[], answers: ParsedAnswer[] } {
  const finalAnswers = answers.map(ans => {
    const q = questions.find(q => q.number === ans.number);
    if (q && q.type === 'VRAI_FAUX') {
      const currentLetter = ans.correctLetter ? String(ans.correctLetter).trim().toUpperCase() : '';
      
      let resolvedLetter = '';
      if (
        currentLetter === 'A' || 
        currentLetter === 'V' || 
        currentLetter === 'VRAI' || 
        currentLetter === 'TRUE' || 
        currentLetter === 'CORRECT' || 
        currentLetter === 'OUI' || 
        currentLetter === '1'
      ) {
        resolvedLetter = 'A';
      } else if (
        currentLetter === 'B' || 
        currentLetter === 'F' || 
        currentLetter === 'FAUX' || 
        currentLetter === 'FALSE' || 
        currentLetter === 'INCORRECT' || 
        currentLetter === 'NON' || 
        currentLetter === '0'
      ) {
        resolvedLetter = 'B';
      } else {
        // It is empty or unrecognized. Let's inspect the explanation / expectedAnswer / questionText
        const searchStr = (
          (ans.expectedAnswer || '') + ' ' + 
          (ans.explanation || '') + ' ' + 
          (q.text || '')
        ).toLowerCase();

        // 1. Check for explicit negative keywords and medical indicators
        if (
          searchStr.includes('bonne réponse est faux') || 
          searchStr.includes('réponse est faux') ||
          searchStr.includes('réponse: faux') ||
          searchStr.includes('réponse : faux') ||
          searchStr.includes('assertion est fausse') ||
          searchStr.includes('proposition est fausse') ||
          searchStr.includes('affirmation est fausse') ||
          searchStr.includes('est faux') ||
          searchStr.includes('est fausse')
        ) {
          resolvedLetter = 'B';
        } else if (
          searchStr.includes('bonne réponse est vrai') || 
          searchStr.includes('réponse est vrai') ||
          searchStr.includes('réponse: vrai') ||
          searchStr.includes('réponse : vrai') ||
          searchStr.includes('assertion est vraie') ||
          searchStr.includes('proposition est vraie') ||
          searchStr.includes('affirmation est vraie')
        ) {
          resolvedLetter = 'A';
        } else if (
          searchStr.includes('contre-indiqué') || 
          searchStr.includes('contre-indiquée') || 
          searchStr.includes('ne doit pas') || 
          searchStr.includes('pas indiqué') ||
          searchStr.includes('interdit') ||
          searchStr.includes('erreur') ||
          searchStr.includes('incorrect')
        ) {
          resolvedLetter = 'B'; // Negative indicators usually mean statement is False
        } else if (
          searchStr.includes('est vrai') || 
          searchStr.includes('vrai') || 
          searchStr.includes('exact') ||
          searchStr.includes('correct')
        ) {
          resolvedLetter = 'A';
        } else if (
          searchStr.includes('faux') || 
          searchStr.includes('fausse')
        ) {
          resolvedLetter = 'B';
        } else {
          // Default fallback
          resolvedLetter = 'A'; 
        }
      }

      return {
        ...ans,
        correctLetter: resolvedLetter,
        correctLetters: [resolvedLetter],
        expectedAnswer: resolvedLetter === 'A' ? 'Vrai' : 'Faux'
      };
    }
    return ans;
  });

  const finalQuestions = questions.map(q => {
    if (q.type === 'VRAI_FAUX') {
      let finalOptions = q.options;
      if (finalOptions.length === 0 || !finalOptions.some(o => o.letter === 'A' || o.letter === 'B')) {
        finalOptions = [
          { letter: 'A', text: 'Vrai' },
          { letter: 'B', text: 'Faux' }
        ];
      } else {
        finalOptions = finalOptions.map(o => {
          if (o.letter === 'A' && (o.text.trim() === '' || o.text.toLowerCase().startsWith('v'))) {
            return { letter: 'A', text: 'Vrai' };
          }
          if (o.letter === 'B' && (o.text.trim() === '' || o.text.toLowerCase().startsWith('f'))) {
            return { letter: 'B', text: 'Faux' };
          }
          return o;
        });
      }
      return {
        ...q,
        options: finalOptions
      };
    }
    return q;
  });

  return { questions: finalQuestions, answers: finalAnswers };
}

