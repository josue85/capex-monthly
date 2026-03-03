const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { fetchCapExData } = require('./jira');
const { getAuthUrl, handleAuthCallback, checkAuthStatus, getValidProjects, getValidPeople, matchEpicToProject, matchPersonToName, appendCapExData, appendNewProjects } = require('./sheets');

const app = express();
app.use(cors());
app.use(express.json());

// --- Google OAuth Routes ---

app.get('/api/auth/status', async (req, res) => {
    const isAuthed = await checkAuthStatus();
    res.json({ authenticated: isAuthed });
});

app.get('/api/auth/google', async (req, res) => {
    try {
        const url = await getAuthUrl();
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
        await handleAuthCallback(code);
        // Redirect back to frontend
        res.redirect('http://localhost:5173');
    } catch (error) {
        console.error('Error during Google Auth Callback:', error);
        res.status(500).send('Authentication failed');
    }
});


// --- Core App Routes ---

app.post('/api/capex/preview', async (req, res) => {
    try {
        const { projectKey, year, month } = req.body;
        
        if (!projectKey || !year || !month) {
            return res.status(400).json({ error: 'Missing required parameters: projectKey, year, month' });
        }

        console.log(`Fetching preview for ${projectKey} - ${year}-${month}`);
        
        // 1. Fetch raw data from Jira
        let data = await fetchCapExData(projectKey, year, month);

        // 2. Try to fetch valid 'NC:' projects and valid people from Sheets for fuzzy matching (if authed)
        const isAuthed = await checkAuthStatus();
        if (isAuthed) {
            const [validProjects, validPeople] = await Promise.all([
                getValidProjects(),
                getValidPeople()
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
        }

        res.json(data);
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Failed to fetch CapEx data from Jira' });
    }
});

app.post('/api/capex/export', async (req, res) => {
    try {
        const { rows, newProjects } = req.body;
        console.log("Received export request with newProjects:", newProjects);
        
        if (!rows || !Array.isArray(rows)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }

        if (newProjects && Array.isArray(newProjects) && newProjects.length > 0) {
            await appendNewProjects(newProjects);
            
            // Also update the rows so the exported CapEx data uses the newly formatted 'NC:' name
            const updatedRows = rows.map(row => {
                if (newProjects.includes(row.Project) && !row.Project.startsWith('NC:')) {
                    return { ...row, Project: `NC: ${row.Project}` };
                }
                return row;
            });
            await appendCapExData(updatedRows);
        } else {
            await appendCapExData(rows);
        }
        
        res.json({ success: true, message: 'Successfully exported to Google Sheets' });
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export to Google Sheets' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
