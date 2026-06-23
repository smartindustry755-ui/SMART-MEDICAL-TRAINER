import { GoogleGenAI, Schema, Type } from "@google/genai";
import { ParsedQuestion, ParsedAnswer } from "../lib/parser";

const apiKey = process.env.GEMINI_API_KEY;

export async function generateQuestionsWithAI(
  inputText: string, 
  contextParams: {filiere: string, niveau: string, chapitre: string, bloc: string}
): Promise<{questions: ParsedQuestion[], answers: ParsedAnswer[]}> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `Tu es un expert médical de la filière ${contextParams.filiere} (Niveau ${contextParams.niveau}).
Tu vas recevoir un texte brut contenant des questions médicales (QCM, QROC, cas cliniques).
Le sujet correspond au chapitre "${contextParams.chapitre}" et bloc "${contextParams.bloc}".

Ton but est d'extraire et de structurer ces questions, et pour CHAQUE question, de générer LA REPONSE CORRECTE, UNE EXPLICATION DETAILLEE et DES REFERENCES PEDAGOGIQUES.

Tu dois répondre UNIQUEMENT avec un objet JSON structuré comme suit :
{
  "questions": [
    {
      "number": 1, // numéro de la question
      "text": "Texte de la question",
      "type": "QCM", // QCM, QROC ou VRAI_FAUX
      "options": [ // Laisse vide pour les QROC. Pour Vrai/Faux, mets A: Vrai, B: Faux.
        {"letter": "A", "text": "Proposition A"},
        {"letter": "B", "text": "Proposition B"}
      ],
      "sharedStem": "Texte du cas clinique s'il y en a un partagé", // Optionnel
      "isGrouped": true, // false si pas de cas clinique partagé
      "groupTitle": "Cas clinique 1" // Optionnel
    }
  ],
  "answers": [
    {
      "number": 1, // Doit correspondre au numéro de la question
      "correctLetter": "A", // La ou les lettres correctes concaténées, ex: "AC" ou "V", "F". Laisse vide pour QROC.
      "correctLetters": ["A", "C"], // Tableau de lettres correctes. [] pour QROC.
      "expectedAnswer": "Réponse textuelle attendue pour les QROC (laisse vide sinon)",
      "explanation": "Texte expliquant en détail la bonne réponse.\\n\\nRéférences : Titre du livre ou article."
    }
  ]
}

- Pour les QCM, extrais bien CHAQUE proposition (A, B, C, D, E...). Et fournis la lettre correcte.
- Ne rajoute pas de balises markdown hors du JSON (le bloc est configuré pour renvoyer du JSON).
- Si tu ne peux vraiment pas y répondre, met "Réponse non déterminée" dans explanation et "A" dans correctLetter pour éviter des bugs bloquants.
- ABSOLUMENT OBLIGATOIRE : Échappe correctement tous les guillemets internes et sauts de ligne dans les chaînes de caractères pour que le JSON soit valide. Utilise "\\n" pour les retours à la ligne. Ne mets jamais de retour à la ligne littéral dans une valeur texte.
`;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            number: { type: Type.INTEGER },
            text: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["QCM", "QROC", "VRAI_FAUX"] },
            options: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  letter: { type: Type.STRING },
                  text: { type: Type.STRING }
                },
                required: ["letter", "text"]
              }
            },
            sharedStem: { type: Type.STRING, nullable: true },
            isGrouped: { type: Type.BOOLEAN, nullable: true },
            groupTitle: { type: Type.STRING, nullable: true }
          },
          required: ["number", "text", "options"]
        }
      },
      answers: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            number: { type: Type.INTEGER },
            correctLetter: { type: Type.STRING },
            correctLetters: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            expectedAnswer: { type: Type.STRING, nullable: true },
            explanation: { type: Type.STRING }
          },
          required: ["number", "correctLetter", "correctLetters", "explanation"]
        }
      }
    },
    required: ["questions", "answers"]
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: inputText,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.2,
        maxOutputTokens: 1000000,
      }
    });

    if (!response.text) throw new Error("Empty response from AI");
    
    let text = response.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    text = text.replace(/[\u0000-\u001F]+/g, " ");
    try {
      const parsed = JSON.parse(text);
      return parsed as { questions: ParsedQuestion[], answers: ParsedAnswer[] };
    } catch (parseError: any) {
      console.error("Erreur de parsing JSON de l'IA (longueur:", text.length, "):", parseError);
      throw new Error(`Erreur de formatage ou texte trop long. Essayez d'importer moins de questions à la fois. (${parseError.message})`);
    }
  } catch (error) {
    console.error("Error generating questions with AI:", error);
    throw error;
  }
}

export async function segmentTextIntoQuestions(text: string): Promise<string[]> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not defined");
  const ai = new GoogleGenAI({ apiKey });

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Liste complète et structurée de chaque question détectée dans le texte brut, incluant son énoncé et toutes ses propositions."
      }
    },
    required: ["questions"]
  };

  const systemInstruction = `Tu es un assistant spécialisé dans l'analyse de sujets d'examens médicaux.
Ton rôle est UNIQUEMENT de segmenter le texte fourni pour extraire une liste propre de questions.
Pour chaque question, tu dois extraire l'énoncé et les propositions associées (A, B, C, D, E...).
Ne fournis AUCUNE réponse. Ne fournis AUCUNE explication. Ne réponds pas aux questions.
Contente-toi de restructurer le texte brut en une liste précise de questions abordées.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: text,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1,
      }
    });

    let resText = response.text?.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim() || "{}";
    resText = resText.replace(/[\u0000-\u001F]+/g, " ");
    const parsed = JSON.parse(resText);
    return parsed.questions || [];
  } catch (error: any) {
    throw new Error("Erreur de parsing lors de la segmentation: " + error.message);
  }
}

export async function processQuestionsBatch(
  questionsBatch: string[], 
  contextParams: {filiere: string, niveau: string, chapitre: string, bloc: string},
  startNumber: number = 1
): Promise<{questions: ParsedQuestion[], answers: ParsedAnswer[]}> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not defined");
  
  // Format the input text as a clear succession of distinct questions
  const inputText = questionsBatch.map((q, i) => `--- QUESTION ${i + 1} ---\n${q}`).join('\n\n');
  
  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `Tu es un expert médical de la filière ${contextParams.filiere} (Niveau ${contextParams.niveau}).
Tu vas recevoir un lot EXACT de ${questionsBatch.length} questions médicales (QCM, QROC, cas cliniques).
Le sujet correspond au chapitre "${contextParams.chapitre}" et bloc "${contextParams.bloc}".

Ton but est d'extraire et de structurer CHACUNE de ces ${questionsBatch.length} questions, et pour chacune, générer LA REPONSE CORRECTE, UNE EXPLICATION DETAILLEE et DES REFERENCES PEDAGOGIQUES.
Il est ABSOLUMENT IMPERATIF que tu retournes EXACTEMENT ${questionsBatch.length} questions dans le tableau "questions" et EXACTEMENT ${questionsBatch.length} réponses correspondantes.
Les numéros de réponse doivent impérativement correspondre aux numéros exacts des questions.

Tu dois répondre UNIQUEMENT avec un objet JSON structuré comme suit :
{
  "questions": [
    {
      "number": 1, // numéro de la question (IMPORTANT : DOIT RESPECTER L'ORDRE FOURNI)
      "text": "Texte de la question",
      "type": "QCM", // QCM, QROC ou VRAI_FAUX
      "options": [ // Laisse vide pour les QROC. Pour Vrai/Faux, mets A: Vrai, B: Faux.
        {"letter": "A", "text": "Proposition A"},
        {"letter": "B", "text": "Proposition B"}
      ],
      "sharedStem": "Texte du cas clinique s'il y en a un partagé", // Optionnel
      "isGrouped": true, // false si pas de cas clinique partagé
      "groupTitle": "Cas clinique 1" // Optionnel
    }
  ],
  "answers": [
    {
      "number": 1, // Doit correspondre au numéro de la question
      "correctLetter": "A", // La ou les lettres correctes concaténées, ex: "AC" ou "V", "F". Laisse vide pour QROC.
      "correctLetters": ["A", "C"], // Tableau de lettres correctes. [] pour QROC.
      "expectedAnswer": "Réponse textuelle attendue pour les QROC (laisse vide sinon)",
      "explanation": "Texte expliquant en détail la bonne réponse.\\n\\nRéférences : Titre du livre ou article."
    }
  ]
}

- Ne rajoute pas de balises markdown hors du JSON.
- Si tu ne connais pas la réponse parfaite, propose la plus probable et indique le doute dans l'explication.
- ABSOLUMENT OBLIGATOIRE : Échappe correctement tous les guillemets internes et sauts de ligne dans les chaînes de caractères pour que le JSON soit valide. Utilise "\\n" pour les retours à la ligne. Ne mets jamais de retour à la ligne littéral dans une valeur texte.
`;

  // We reuse the exact same schema structure as generateQuestionsWithAI
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            number: { type: Type.INTEGER },
            text: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["QCM", "QROC", "VRAI_FAUX"] },
            options: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { letter: { type: Type.STRING }, text: { type: Type.STRING } },
                required: ["letter", "text"]
              }
            },
            sharedStem: { type: Type.STRING, nullable: true },
            isGrouped: { type: Type.BOOLEAN, nullable: true },
            groupTitle: { type: Type.STRING, nullable: true }
          },
          required: ["number", "text", "options"]
        }
      },
      answers: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            number: { type: Type.INTEGER },
            correctLetter: { type: Type.STRING },
            correctLetters: { type: Type.ARRAY, items: { type: Type.STRING } },
            expectedAnswer: { type: Type.STRING, nullable: true },
            explanation: { type: Type.STRING }
          },
          required: ["number", "correctLetter", "correctLetters", "explanation"]
        }
      }
    },
    required: ["questions", "answers"]
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: inputText,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1, // very low to respect constraints
        maxOutputTokens: 1000000,
      }
    });

    if (!response.text) throw new Error("Empty response from AI");
    
    let text = response.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    
    // Sanitize control characters that break JSON.parse if they appear unescaped in strings
    text = text.replace(/[\u0000-\u001F]+/g, " ");
    
    try {
      const parsed = JSON.parse(text) as { questions: ParsedQuestion[], answers: ParsedAnswer[] };
      
      // We explicitly overwrite the generated 'number' fields to ensure continuity matching our batch
      parsed.questions.forEach((q, i) => {
        q.number = startNumber + i;
      });
      parsed.answers.forEach((a, i) => {
        a.number = startNumber + i;
      });
      
      return parsed;
    } catch (parseError: any) {
      console.error("Failed to parse JSON in batch:", text.substring(0, 100) + "...", "... " + text.substring(text.length - 100));
      throw new Error(`JSON parsing error: ${parseError.message}`);
    }
  } catch (error: any) {
    throw new Error(`Erreur traitement lot IA: ${error.message}`);
  }
}

export async function generateMindMap(context: string): Promise<string> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined");
  }

  const ai = new GoogleGenAI({ apiKey });

  
  const prompt = `Génère une carte mentale structurée pour le contenu suivant. 
Utilise EXCLUSIVEMENT les symboles suivants suivis d'un POINT pour la hiérarchie :
- "#." pour le tronc (niveau 1)
- ">." pour les branches (niveau 2)
- "-." pour les sous-branches (niveau 3)
- "*." pour les feuilles (niveau 4)

Règles :
- Chaque ligne doit commencer par un symbole suivi d'un point (ex: "#. Titre").
- Ne pas utiliser d'espaces au début pour la hiérarchie.
- Assure une structure logique et profonde.

Contenu :
${context}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.7,
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("Error generating mind map:", error);
    throw error;
  }
}

export interface TableBlank {
  rowIndex: number;
  colIndex: number;
  expectedValue: string;
  placeholder?: string;
}

export interface TableData {
  tableName: string;
  headers: string[];
  rows: string[][];
  blanks: TableBlank[];
}

export async function analyzeTableImageWithAI(params: { imageUrl?: string; base64?: string }): Promise<TableData> {
  const response = await fetch("/api/analyze-table", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedError;
    try {
      parsedError = JSON.parse(errorText);
    } catch {
      parsedError = { error: errorText };
    }
    throw new Error(parsedError.error || "Failed to analyze table with AI");
  }

  return await response.json();
}

