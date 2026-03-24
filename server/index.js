const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { fetchCapExData } = require('./jira');
const { getAuthUrl, handleAuthCallback, checkAuthStatus, getValidProjects, getValidPeople, matchEpicToProject, matchPersonToName, appendCapExData, appendNewProjects, getSpreadsheetInfo, getRecentSpreadsheets } = require('./sheets');
const { getTemplateVariables, generateBrdDocument } = require('./docs');
const { extractVariablesFromText } = require('./extract');

const app = express();
app.use(cors());
app.use(express.json());

function getBaseUrl(req) {
    if (process.env.APP_BASE_URL) {
        return process.env.APP_BASE_URL;
    }

    const host = req.get('host');
    if (!host) {
        return `${req.protocol}://localhost:8080`;
    }

    const normalizedHost = host.replace(/^127\.0\.0\.1(?=[:]|$)/, 'localhost');
    return `${req.protocol}://${normalizedHost}`;
}

// --- Google OAuth Routes ---

app.get('/api/auth/status', async (req, res) => {
    const isAuthed = await checkAuthStatus();
    res.json({ authenticated: isAuthed });
});

app.get('/api/auth/google', async (req, res) => {
    try {
        const redirectUri = `${getBaseUrl(req)}/api/auth/google/callback`;
        const url = await getAuthUrl(redirectUri);
        res.redirect(url);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/auth/google/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send('Missing code parameter');
    }
    
    try {
        const redirectUri = `${getBaseUrl(req)}/api/auth/google/callback`;
        await handleAuthCallback(code, redirectUri);
        // Redirect back to frontend
        res.redirect('/');
    } catch (error) {
        console.error('Error during Google Auth Callback:', error);
        res.status(500).send('Authentication failed');
    }
});


// --- Core App Routes ---

app.post('/api/sheet/info', async (req, res) => {
    try {
        const { spreadsheetId } = req.body;
        if (!spreadsheetId) {
            return res.status(400).json({ error: 'Missing spreadsheetId' });
        }

        // Basic parsing just in case they paste the full URL
        let finalId = spreadsheetId;
        const match = spreadsheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
            finalId = match[1];
        }

        const info = await getSpreadsheetInfo(finalId);
        res.json(info);
    } catch (error) {
        console.error('Sheet info error:', error);
        res.status(error.status || 500).json({ error: error.message || 'Failed to fetch spreadsheet info' });
    }
});

app.get('/api/sheets/recent', async (req, res) => {
    try {
        const isAuthed = await checkAuthStatus();
        if (!isAuthed) return res.status(401).json({ error: 'Not authenticated' });

        const files = await getRecentSpreadsheets();
        res.json({ files });
    } catch (error) {
        console.error('Recent sheets error:', error);
        res.status(error.status || 500).json({ error: error.message || 'Failed to fetch recent sheets' });
    }
});

app.post('/api/capex/preview', async (req, res) => {
    try {
        const { projectKey, year, month, managerName, spreadsheetId } = req.body;
        
        if (!projectKey || !year || !month) {
            return res.status(400).json({ error: 'Missing required parameters: projectKey, year, month' });
        }

        // Extract ID if URL was passed
        let finalSheetId = spreadsheetId;
        if (finalSheetId) {
            const match = finalSheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                finalSheetId = match[1];
            }
        }

        console.log(`Fetching preview for ${projectKey} - ${year}-${month}`);
        
        // 1. Fetch raw data from Jira
        let data = await fetchCapExData(projectKey, year, month, managerName);

        // 2. Try to fetch valid 'NC:' projects and valid people from Sheets for fuzzy matching (if authed)
        const isAuthed = await checkAuthStatus();
        if (isAuthed && finalSheetId) {
            try {
                const [validProjects, validPeople] = await Promise.all([
                    getValidProjects(finalSheetId),
                    getValidPeople(finalSheetId)
                ]);

                data = data.map(row => {
                    let mappedProject = row.Project;
                    let mappedPerson = row.Person;

                    if (validProjects.length > 0) {
                        mappedProject = matchEpicToProject(row.Project, validProjects);
                    }

                    if (validPeople.length > 0) {
                        mappedPerson = matchPersonToName(row.Person, validPeople);
                    }

                    return {
                        ...row,
                        OriginalEpic: row.Project,
                        Project: mappedProject,
                        OriginalPerson: row.Person,
                        Person: mappedPerson
                    };
                });
            } catch (sheetError) {
                console.warn('Could not fetch valid lists for matching (might be invalid sheet ID):', sheetError.message);
                // Proceed without fuzzy matching
            }
        }

        res.json(data);
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Failed to fetch CapEx data from Jira' });
    }
});

app.post('/api/capex/export', async (req, res) => {
    try {
        const { rows, newProjects, managerName, spreadsheetId } = req.body;
        console.log("Received export request with newProjects:", newProjects);
        
        if (!rows || !Array.isArray(rows)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        if (!spreadsheetId) {
            return res.status(400).json({ error: 'Missing spreadsheetId' });
        }
        
        // Extract ID if URL was passed
        let finalSheetId = spreadsheetId;
        const match = finalSheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
            finalSheetId = match[1];
        }

        if (newProjects && Array.isArray(newProjects) && newProjects.length > 0) {
            // Check if brdUrls are passed, mapping project names to their generated doc URLs
            const { brdUrls } = req.body;
            await appendNewProjects(newProjects, managerName, finalSheetId, brdUrls || {});
            
            // Also update the rows so the exported CapEx data uses the newly formatted 'NC:' name
            const updatedRows = rows.map(row => {
                if (newProjects.includes(row.Project) && !row.Project.startsWith('NC:')) {
                    return { ...row, Project: `NC: ${row.Project}` };
                }
                return row;
            });
            const exportRows = updatedRows.filter(row => row.Project !== 'No Epic');
            await appendCapExData(exportRows, finalSheetId);
        } else {
            const exportRows = rows.filter(row => row.Project !== 'No Epic');
            await appendCapExData(exportRows, finalSheetId);
        }
        
        res.json({ success: true, message: 'Successfully exported to Google Sheets' });
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export to Google Sheets' });
    }
});

// --- BRD Generation Routes ---

app.post('/api/brd/template-variables', async (req, res) => {
    try {
        const templateUrl = process.env.BRD_TEMPLATE_URL;
        if (!templateUrl) return res.status(500).json({ error: 'BRD_TEMPLATE_URL is not configured in the server environment.' });
        
        const variables = await getTemplateVariables(templateUrl);
        res.json({ variables });
    } catch (error) {
        console.error('Template parsing error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/brd/extract', async (req, res) => {
    try {
        const { textOrUrls, variables } = req.body;
        if (!textOrUrls || !variables) return res.status(400).json({ error: 'Missing textOrUrls or variables' });
        
        const extractedData = await extractVariablesFromText(textOrUrls, variables);
        res.json({ extractedData });
    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/brd/generate', async (req, res) => {
    try {
        const templateUrl = process.env.BRD_TEMPLATE_URL;
        const { projectName, variablesMap } = req.body;
        if (!templateUrl) return res.status(500).json({ error: 'BRD_TEMPLATE_URL is not configured in the server environment.' });
        if (!projectName || !variablesMap) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        
        const docUrl = await generateBrdDocument(templateUrl, projectName, variablesMap);
        res.json({ url: docUrl });
    } catch (error) {
        console.error('Document generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve frontend in production
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
