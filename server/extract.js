const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getJiraClient } = require('./jira');
const { google } = require('googleapis');
const { getAuth } = require('./sheets');
require('dotenv').config();

// Extract document ID
function extractIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

// Helper to extract text from a Google Doc
async function extractGoogleDocText(url) {
    const documentId = extractIdFromUrl(url);
    if (!documentId) return '';

    const auth = await getAuth();
    if (!auth) throw new Error("Google API authentication not configured");

    const docs = google.docs({ version: 'v1', auth });
    const drive = google.drive({ version: 'v3', auth });
    
    try {
        let ownerName = 'Unknown';
        try {
            const fileMeta = await drive.files.get({ fileId: documentId, fields: 'owners' });
            if (fileMeta.data.owners && fileMeta.data.owners.length > 0) {
                ownerName = fileMeta.data.owners[0].displayName;
            }
        } catch (e) {
            console.warn('Could not fetch document owner:', e.message);
        }

        const response = await docs.documents.get({ documentId });
        const doc = response.data;
        let text = `[Document Owner: ${ownerName}]\n\n`;

        if (doc.body && doc.body.content) {
            for (const structuralElement of doc.body.content) {
                if (structuralElement.paragraph) {
                    for (const element of structuralElement.paragraph.elements) {
                        if (element.textRun && element.textRun.content) {
                            text += element.textRun.content;
                        }
                    }
                }
            }
        }
        return text;
    } catch (err) {
        console.error('Error reading Google Doc for extraction:', err.message);
        return `[Could not read Google Doc: ${err.message}]`;
    }
}

// Helper to extract Jira Description
async function extractJiraText(url) {
    // Expected format: https://domain.atlassian.net/browse/PROJECT-123
    const match = url.match(/\/browse\/([A-Z0-9-]+)/);
    if (!match) return '';
    const issueKey = match[1];

    try {
        const client = getJiraClient();
        const response = await client.get(`/issue/${issueKey}?fields=summary,description,creator`);
        
        const summary = response.data.fields.summary || '';
        const creator = response.data.fields.creator?.displayName || response.data.fields.creator?.name || '';
        let description = '';
        
        // Jira API v3 uses Atlassian Document Format (ADF) for description
        const descField = response.data.fields.description;
        if (descField && descField.content) {
            // Very basic ADF parser to plain text
            const extractAdfText = (node) => {
                let nodeText = '';
                if (node.text) nodeText += node.text;
                if (node.content) {
                    for (const child of node.content) {
                        nodeText += extractAdfText(child) + ' ';
                    }
                }
                return nodeText;
            };
            description = extractAdfText(descField);
        } else if (typeof descField === 'string') {
            description = descField; // Fallback if v2 API or plain string
        }
        
        return `Jira Summary: ${summary}\nJira Creator: ${creator}\nJira Description: ${description}`;
    } catch (err) {
        console.error(`Error reading Jira issue ${issueKey}:`, err.message);
        return `[Could not read Jira issue: ${err.message}]`;
    }
}

// Helper for Confluence (Stubbed for on-prem / token setup)
async function extractConfluenceText(url) {
    const domain = process.env.CONFLUENCE_DOMAIN;
    const token = process.env.CONFLUENCE_API_TOKEN;
    
    if (!domain || !token) {
        return `[Confluence extraction requires CONFLUENCE_DOMAIN and CONFLUENCE_API_TOKEN in .env]`;
    }

    // This is a basic implementation assuming standard REST API structure 
    // for Confluence Server/Data Center or Cloud. 
    // Actual implementation depends on exact Confluence version and URL format.
    try {
        // e.g. parse page ID from URL or title
        // Returning placeholder for now, but ready to be expanded
        return `[Confluence text extracted from ${url} - Detailed implementation depends on on-prem URL structure]`;
    } catch (err) {
        return `[Could not read Confluence: ${err.message}]`;
    }
}

async function extractVariablesFromText(urlsTextRaw, variablesList) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing from .env");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // or gemini-1.5-pro
    
    // Parse the input block (might be a mix of URLs and plain text)
    // We'll separate URLs and fetch them, and keep the rest as plain text
    const words = urlsTextRaw.split(/[\s\n]+/);
    let combinedContext = '';
    
    for (const word of words) {
        if (word.startsWith('http://') || word.startsWith('https://')) {
            if (word.includes('docs.google.com/document')) {
                combinedContext += `\n\n--- Google Doc Content ---\n`;
                combinedContext += await extractGoogleDocText(word);
            } else if (word.includes('atlassian.net/browse') || word.includes('/browse/')) {
                combinedContext += `\n\n--- Jira Epic Content ---\n`;
                combinedContext += await extractJiraText(word);
            } else if (word.includes('confluence')) {
                combinedContext += `\n\n--- Confluence Content ---\n`;
                combinedContext += await extractConfluenceText(word);
            } else {
                combinedContext += `\n[Unrecognized URL format: ${word}]\n`;
            }
        } else {
            combinedContext += word + ' ';
        }
    }

    const prompt = `
You are a technical business analyst. I will provide you with a context text (which may contain project summaries, descriptions, or requirements).
I will also provide a list of variables. 

Your task is to analyze the context text and extract the most appropriate value for each variable.
If a variable's information cannot be found or inferred from the text, return an empty string for that variable.

Important clues to consider:
1. The Product Manager is likely the person who created the Jira Epic (listed as Jira Creator).
2. If a Statement of Work (SoW) Google Doc is provided, its "Document Owner" is likely to be the "Technical PIC".

Output the result strictly as a valid JSON object where the keys are the variable names. Do not include markdown formatting like \`\`\`json.

Variables to extract:
${JSON.stringify(variablesList)}

Context text:
${combinedContext.substring(0, 30000)} 
`;

    try {
        const result = await model.generateContent(prompt);
        let rawResponse = result.response.text();
        
        // Cleanup markdown if the model accidentally included it
        if (rawResponse.startsWith('```json')) {
            rawResponse = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        } else if (rawResponse.startsWith('```')) {
            rawResponse = rawResponse.replace(/```/g, '').trim();
        }

        return JSON.parse(rawResponse);
    } catch (err) {
        console.error('Gemini extraction failed:', err);
        throw new Error('Failed to auto-extract data using AI: ' + err.message);
    }
}

module.exports = {
    extractVariablesFromText
};
