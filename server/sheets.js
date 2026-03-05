const { google } = require('googleapis');
const stringSimilarity = require('string-similarity');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Remove hardcoded SPREADSHEET_ID
const TOKEN_PATH = path.join(__dirname, 'token.json');

function getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
    
    if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
    }
    
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getAuthUrl() {
    const oAuth2Client = getOAuth2Client();
    return oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/drive'
        ],
        prompt: 'consent'
    });
}

async function handleAuthCallback(code) {
    const oAuth2Client = getOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    return tokens;
}

async function checkAuthStatus() {
    try {
        await fs.access(TOKEN_PATH);
        return true;
    } catch (error) {
        return false;
    }
}

async function getAuth() {
    const oAuth2Client = getOAuth2Client();
    try {
        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (err) {
        console.warn('Google OAuth token not found. User needs to authenticate.');
        return null;
    }
}

async function getValidProjects(spreadsheetId) {
    const auth = await getAuth();
    if (!auth) return [];
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Projects!C:C', // Project names are actually in column C
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        // Filter projects that start with "NC:"
        return rows
            .map(row => row[0])
            .filter(name => name && name.trim().startsWith('NC:'));
    } catch (error) {
        console.error('Error fetching valid projects from Sheets:', error.message);
        return [];
    }
}

async function getValidPeople(spreadsheetId) {
    const auth = await getAuth();
    if (!auth) return [];
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'People!A:A', // Assuming canonical names are in People tab, column A
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        return rows
            .map(row => row[0])
            .filter(name => name && name.trim() !== '' && name.trim() !== 'Name'); // Filter out empty and header
    } catch (error) {
        console.error('Error fetching valid people from Sheets:', error.message);
        return [];
    }
}

function matchEpicToProject(epicName, validProjects) {
    if (!validProjects || validProjects.length === 0) return epicName;
    if (!epicName || epicName === 'No Epic') return 'No Epic';

    // Find the best fuzzy match
    const matches = stringSimilarity.findBestMatch(epicName, validProjects);
    
    // If the best match is good enough (e.g. > 0.3 similarity), use it, otherwise return original
    if (matches.bestMatch.rating > 0.3) {
        return matches.bestMatch.target;
    }
    
    return epicName; // Return original if no good match
}

function matchPersonToName(personName, validPeople) {
    if (!validPeople || validPeople.length === 0) return personName;
    if (!personName) return personName;

    const matches = stringSimilarity.findBestMatch(personName, validPeople);
    
    // Use a slightly higher threshold for people to avoid weird mapping
    if (matches.bestMatch.rating > 0.4) {
        return matches.bestMatch.target;
    }
    
    return personName;
}

async function appendCapExData(rows, spreadsheetId) {
    if (!rows || rows.length === 0) return;
    
    const auth = await getAuth();
    if (!auth) throw new Error("Google Sheets authentication not configured");

    const sheets = google.sheets({ version: 'v4', auth });

    // Format rows for the sheet
    // Columns should map as: 
    // A: Brand (e.g., NetCredit) - hardcoding to NetCredit for now based on your other function
    // B: Person
    // C through I: Empty or other data?
    // J: Project Name
    
    // Wait, let's map it based on the exact structure you requested:
    // "the project name in Column B (it should be Column J) and the person's name should go to column B (right now it's going into column a)"

    // Let's assume the columns are:
    // A: Brand (NetCredit)
    // B: Person Name
    // C: Design
    // D: Development
    // E: QA
    // F: Training
    // G: Project Management
    // H: Project Oversight
    // I: (Empty)
    // J: Project Name
    
    const values = rows.map(row => [
        "",                       // A (Left blank as requested)
        row.Person,               // B
        row.Design,               // C
        row.Development,          // D
        row.QA,                   // E
        row.Training,             // F
        row.ProjectManagement,    // G
        row.ProjectOversight,     // H
        "",                       // I
        row.Project               // J
    ]);

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: 'NetCredit!B:B', // Target B:B so it accurately finds the bottom of the existing list (since A is now empty)
            valueInputOption: 'USER_ENTERED', 
            insertDataOption: 'INSERT_ROWS', // Force it to insert rows correctly
            requestBody: {
                majorDimension: 'ROWS',
                values: values
            }
        });
        return { success: true };
    } catch (error) {
        console.error('Error writing to Sheets:', error.message);
        throw error;
    }
}

async function appendNewProjects(newProjects, managerName, spreadsheetId, brdUrls = {}) {
    if (!newProjects || newProjects.length === 0) return;
    
    const auth = await getAuth();
    if (!auth) throw new Error("Google Sheets authentication not configured");

    const sheets = google.sheets({ version: 'v4', auth });

    // Format new projects
    // Column A: NetCredit, B: Manager Name, C: NC: + Project Name, D: (BRD URL or Blank), E: TRUE (checked), F: In Progress, J: 5
    const values = newProjects.map(proj => {
        const projectName = proj.startsWith('NC') ? proj : `NC: ${proj}`;
        const docUrl = brdUrls[proj] || "";
        return [
            "NetCredit",         // A
            managerName || "Manager, Name", // B
            projectName,         // C
            docUrl,              // D (BRD Link)
            "TRUE",              // E (Checkbox)
            "In Progress",       // F
            "",                  // G
            "",                  // H
            "",                  // I
            "5"                  // J
        ];
    });

    try {
        // First find the actual last row by checking Column C
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Projects!C:C',
        });
        
        const rows = response.data.values || [];
        // Find the last index that actually has a value
        let lastRowIndex = rows.length;
        while (lastRowIndex > 0 && (!rows[lastRowIndex - 1] || !rows[lastRowIndex - 1][0] || rows[lastRowIndex - 1][0].trim() === '')) {
            lastRowIndex--;
        }
        
        const insertRow = lastRowIndex + 1;

        // Use update instead of append to put it exactly where we want it, 
        // avoiding issues with pre-formatted blank rows at the bottom of the sheet.
        await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: `Projects!A${insertRow}:J${insertRow + values.length - 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                majorDimension: 'ROWS',
                values: values
            }
        });
        console.log(`Successfully appended ${newProjects.length} new projects starting at row ${insertRow}.`);
    } catch (error) {
        console.error('Error writing new projects to Sheets:', error.message);
        throw error;
    }
}

async function getSpreadsheetInfo(spreadsheetId) {
    const auth = await getAuth();
    if (!auth) throw new Error("Google Sheets authentication not configured");
    const sheets = google.sheets({ version: 'v4', auth });
    
    try {
        const response = await sheets.spreadsheets.get({
            spreadsheetId
        });
        return {
            title: response.data.properties.title,
            spreadsheetId: response.data.spreadsheetId
        };
    } catch (error) {
        console.error('Error fetching spreadsheet info:', error.message);
        throw new Error('Failed to access spreadsheet. Please check the ID/URL and your permissions.');
    }
}

async function getRecentSpreadsheets() {
    const auth = await getAuth();
    if (!auth) throw new Error("Google API authentication not configured");

    const drive = google.drive({ version: 'v3', auth });
    try {
        const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
            orderBy: "recency desc",
            pageSize: 10,
            fields: "files(id, name, modifiedTime, iconLink, webViewLink)"
        });
        return response.data.files || [];
    } catch (error) {
        console.error('Error fetching recent spreadsheets:', error.message);
        throw new Error('Failed to fetch recent spreadsheets.');
    }
}

module.exports = {
    getAuth,
    getAuthUrl,
    handleAuthCallback,
    checkAuthStatus,
    getValidProjects,
    getValidPeople,
    matchEpicToProject,
    matchPersonToName,
    appendCapExData,
    appendNewProjects,
    getSpreadsheetInfo,
    getRecentSpreadsheets
};
