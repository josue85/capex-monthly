const { google } = require('googleapis');
const { getAuth } = require('./sheets');

function extractIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : url; // fallback to assuming it's an ID if no match
}

async function getTemplateVariables(documentUrl) {
    const documentId = extractIdFromUrl(documentUrl);
    if (!documentId) throw new Error("Invalid document URL or ID");

    const auth = await getAuth();
    if (!auth) throw new Error("Google API authentication not configured");

    const docs = google.docs({ version: 'v1', auth });
    
    try {
        const response = await docs.documents.get({
            documentId: documentId,
        });

        const doc = response.data;
        const variables = new Set();
        const regex = /\{\{([^}]+)\}\}/g;

        // Traverse the document content
        if (doc.body && doc.body.content) {
            for (const structuralElement of doc.body.content) {
                if (structuralElement.paragraph) {
                    for (const element of structuralElement.paragraph.elements) {
                        if (element.textRun && element.textRun.content) {
                            const text = element.textRun.content;
                            let match;
                            while ((match = regex.exec(text)) !== null) {
                                variables.add(match[1].trim());
                            }
                        }
                    }
                } else if (structuralElement.table) {
                    for (const row of structuralElement.table.tableRows) {
                        for (const cell of row.tableCells) {
                            for (const cellContent of cell.content) {
                                if (cellContent.paragraph) {
                                    for (const element of cellContent.paragraph.elements) {
                                        if (element.textRun && element.textRun.content) {
                                            const text = element.textRun.content;
                                            let match;
                                            while ((match = regex.exec(text)) !== null) {
                                                variables.add(match[1].trim());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return Array.from(variables);
    } catch (error) {
        console.error('Error fetching document variables:', error.message);
        throw new Error(`Failed to read template: ${error.message}`);
    }
}

async function generateBrdDocument(templateUrl, title, variablesMap) {
    const templateId = extractIdFromUrl(templateUrl);
    if (!templateId) throw new Error("Invalid template URL or ID");

    const auth = await getAuth();
    if (!auth) throw new Error("Google API authentication not configured");

    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });

    try {
        // 1. Duplicate the template
        const copyResponse = await drive.files.copy({
            fileId: templateId,
            requestBody: {
                name: `BRD: ${title}`
            }
        });
        
        const newDocumentId = copyResponse.data.id;

        // 2. Prepare batch update requests to replace variables
        const requests = [];
        for (const [key, value] of Object.entries(variablesMap)) {
            // Docs API replaceAllText needs string values
            const replaceText = value != null ? String(value) : '';
            requests.push({
                replaceAllText: {
                    containsText: {
                        text: `{{${key}}}`,
                        matchCase: true,
                    },
                    replaceText: replaceText,
                }
            });
        }

        // 3. Apply updates if there are any variables
        if (requests.length > 0) {
            await docs.documents.batchUpdate({
                documentId: newDocumentId,
                requestBody: {
                    requests,
                }
            });
        }

        // Return the URL to the new document
        return `https://docs.google.com/document/d/${newDocumentId}/edit`;
    } catch (error) {
        console.error('Error generating document:', error.message);
        throw new Error(`Failed to generate document: ${error.message}`);
    }
}

module.exports = {
    getTemplateVariables,
    generateBrdDocument
};
