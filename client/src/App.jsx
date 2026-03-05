import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [projectKey, setProjectKey] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [managerName, setManagerName] = useState(localStorage.getItem('capexManagerName') || '');
  const [spreadsheetInput, setSpreadsheetInput] = useState(localStorage.getItem('capexSpreadsheetId') || '1hkoNfwzdS3bmAcsSR_eB4pv8K3Lfo6d42oqPsVrEIJU');
  const [spreadsheetInfo, setSpreadsheetInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);
  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [selectedNewProjects, setSelectedNewProjects] = useState([]);
  const [generatedBrds, setGeneratedBrds] = useState({});
  const [brdModalProject, setBrdModalProject] = useState(null);
  const [brdVariables, setBrdVariables] = useState([]);
  const [brdFormValues, setBrdFormValues] = useState({});
  const [brdInputText, setBrdInputText] = useState('');
  const [brdLoading, setBrdLoading] = useState(false);
  const [brdMessage, setBrdMessage] = useState(null);

  // Sheet Picker State
  const [isSheetPickerOpen, setIsSheetPickerOpen] = useState(false);
  const [recentSheets, setRecentSheets] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [manualSheetUrl, setManualSheetUrl] = useState('');

  useEffect(() => {
    localStorage.setItem('capexManagerName', managerName);
  }, [managerName]);

  useEffect(() => {
    localStorage.setItem('capexSpreadsheetId', spreadsheetInput);
  }, [spreadsheetInput]);

  useEffect(() => {
    // Check if the backend has Google OAuth tokens saved
    const checkAuth = async () => {
      try {
        const response = await axios.get('/api/auth/status');
        setIsGoogleAuthed(response.data.authenticated);
        if (response.data.authenticated && spreadsheetInput) {
          fetchSheetInfo(spreadsheetInput);
        }
      } catch (err) {
        console.error("Failed to check auth status", err);
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  const fetchSheetInfo = async (idOrUrl) => {
    if (!idOrUrl) return;
    setSheetLoading(true);
    try {
      const response = await axios.post('/api/sheet/info', { spreadsheetId: idOrUrl });
      setSpreadsheetInfo(response.data);
    } catch (err) {
      console.error("Failed to fetch sheet info", err);
      setSpreadsheetInfo(null);
    } finally {
      setSheetLoading(false);
    }
  };

  const fetchPreview = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setExportStatus(null);

    try {
      const response = await axios.post('/api/capex/preview', {
        projectKey,
        year: parseInt(year),
        month: parseInt(month),
        managerName,
        spreadsheetId: spreadsheetInput
      });
      setData(response.data);
      setSelectedNewProjects([]); // Reset on new preview
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!data) return;
    setLoading(true);
    setExportStatus(null);
    
    try {
      await axios.post('/api/capex/export', { 
        rows: data,
        newProjects: selectedNewProjects,
        managerName,
        spreadsheetId: spreadsheetInput,
        brdUrls: generatedBrds
      });
      setExportStatus('success');
      setSelectedNewProjects([]); // Clear after successful export
      setGeneratedBrds({}); // Clear BRDs
    } catch (err) {
      setExportStatus('error');
      setError('Failed to export to Google Sheets: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const unmatchedProjects = data ? Array.from(new Set(
    data
      .filter(row => row.Project !== 'No Epic' && !row.Project.startsWith('NC:'))
      .map(row => row.Project)
  )) : [];

  const handleToggleNewProject = (proj) => {
    setSelectedNewProjects(prev => 
      prev.includes(proj) ? prev.filter(p => p !== proj) : [...prev, proj]
    );
  };

  const openBrdModal = async (proj) => {
    setBrdModalProject(proj);
    setBrdVariables([]);
    setBrdFormValues({});
    setBrdInputText('');
    setBrdMessage(null);
    setBrdLoading(true);

    try {
      const res = await axios.post('/api/brd/template-variables', {});
      setBrdVariables(res.data.variables);
      const initialValues = {};
      res.data.variables.forEach(v => initialValues[v] = '');
      setBrdFormValues(initialValues);
    } catch (err) {
      setBrdMessage({ type: 'error', text: 'Failed to read template variables. ' + (err.response?.data?.error || err.message) });
    } finally {
      setBrdLoading(false);
    }
  };

  const closeBrdModal = () => {
    setBrdModalProject(null);
  };

  const handleAutoExtract = async () => {
    if (!brdInputText.trim()) return;
    setBrdLoading(true);
    setBrdMessage({ type: 'info', text: 'Extracting data with AI...' });
    
    try {
      const res = await axios.post('/api/brd/extract', {
        textOrUrls: brdInputText,
        variables: brdVariables
      });
      const extracted = res.data.extractedData;
      
      setBrdFormValues(prev => ({
        ...prev,
        ...extracted
      }));
      setBrdMessage({ type: 'success', text: 'Extraction complete! Please review the fields.' });
    } catch (err) {
      setBrdMessage({ type: 'error', text: 'Extraction failed. ' + (err.response?.data?.error || err.message) });
    } finally {
      setBrdLoading(false);
    }
  };

  const handleGenerateBrd = async () => {
    setBrdLoading(true);
    setBrdMessage({ type: 'info', text: 'Generating document...' });

    try {
      const res = await axios.post('/api/brd/generate', {
        projectName: brdModalProject,
        variablesMap: brdFormValues
      });
      
      setGeneratedBrds(prev => ({
        ...prev,
        [brdModalProject]: res.data.url
      }));
      
      // Auto-check the project so it gets exported
      if (!selectedNewProjects.includes(brdModalProject)) {
        setSelectedNewProjects(prev => [...prev, brdModalProject]);
      }
      
      setBrdMessage({ type: 'success', text: 'Document generated successfully!' });
      setTimeout(() => closeBrdModal(), 2000);
    } catch (err) {
      setBrdMessage({ type: 'error', text: 'Generation failed. ' + (err.response?.data?.error || err.message) });
    } finally {
      setBrdLoading(false);
    }
  };

  const openSheetPicker = async () => {
    setIsSheetPickerOpen(true);
    setManualSheetUrl('');
    if (!isGoogleAuthed) return;
    
    setLoadingRecent(true);
    try {
      const res = await axios.get('/api/sheets/recent');
      setRecentSheets(res.data.files || []);
    } catch (err) {
      console.error('Failed to load recent sheets', err);
    } finally {
      setLoadingRecent(false);
    }
  };

  const selectSheet = async (idOrUrl) => {
    setSpreadsheetInput(idOrUrl);
    setIsSheetPickerOpen(false);
    await fetchSheetInfo(idOrUrl);
  };

  return (
    <div className="min-h-screen bg-enova-bg p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="bg-white rounded-xl shadow-sm p-6 border-t-4 border-t-enova-light border-x border-b border-gray-100 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <div className="flex items-center gap-4">
            <img src="https://www.enova.com/wp-content/uploads/sites/3/2018/12/enova-logo.svg" alt="Enova" className="h-8" />
            <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>
            <div>
              <h1 className="text-xl font-bold text-enova-dark">Monthly CapEx Generator</h1>
              <p className="text-gray-500 text-xs mt-0.5">Pull Jira data and format it for Google Sheets</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {!checkingAuth && (
              isGoogleAuthed ? (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1.5 rounded-full text-sm font-medium border border-green-200">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                    Google Connected
                  </div>
                </div>
              ) : (
                <a 
                  href="/api/auth/google"
                  className="flex items-center gap-2 bg-white text-gray-700 px-4 py-2 rounded-md text-sm font-medium border border-gray-300 hover:border-enova-light hover:text-enova-light transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Connect Google Sheets
                </a>
              )
            )}
          </div>
        </header>

        <main className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          
          {/* Prominent Sheet Banner */}
          <div className="mb-8 p-5 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4 w-full md:w-auto">
              <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19.5 3h-15C3.12 3 2 4.12 2 5.5v13C2 19.88 3.12 21 4.5 21h15c1.38 0 2.5-1.12 2.5-2.5v-13C22 4.12 20.88 3 19.5 3zM19 19H5V5h14v14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Target Spreadsheet</p>
                {sheetLoading ? (
                  <p className="text-lg font-bold text-gray-400">Loading...</p>
                ) : spreadsheetInfo ? (
                  <a href={`https://docs.google.com/spreadsheets/d/${spreadsheetInfo.spreadsheetId}/edit`} target="_blank" rel="noreferrer" className="text-lg font-bold text-gray-800 hover:text-enova-light transition-colors truncate block">
                    {spreadsheetInfo.title}
                  </a>
                ) : (
                  <p className="text-lg font-bold text-gray-400">No sheet selected</p>
                )}
              </div>
            </div>
            <button
              onClick={openSheetPicker}
              className="bg-white border border-gray-300 hover:border-enova-light hover:text-enova-light text-gray-700 font-medium px-4 py-2 rounded-md shadow-sm transition-all duration-200 whitespace-nowrap"
            >
              {spreadsheetInfo ? 'Change Sheet' : 'Select Sheet'}
            </button>
          </div>

          <form onSubmit={fetchPreview} className="flex flex-wrap items-end gap-4 mb-8">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-enova-dark">Jira Project Key</label>
              <input
                type="text"
                required
                list="jira-projects"
                placeholder="e.g. NCOR"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-enova-light focus:border-enova-light focus:outline-none bg-white"
              />
              <datalist id="jira-projects">
                <option value="CCR">Consumer Core (CCR)</option>
                <option value="NCCYG">Cygnus (NCCYG)</option>
                <option value="NCFE">Front End Team (NCFE)</option>
                <option value="NCLX">Lynx (NCLX)</option>
                <option value="NCOR">Orion (NCOR)</option>
                <option value="NCPG">Pegasus (NCPG)</option>
                <option value="NCPH">Phoenix (NCPH)</option>
                <option value="NCVG">Vega (NCVG)</option>
              </datalist>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-enova-dark">Year</label>
              <input
                type="number"
                required
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 w-24 focus:ring-2 focus:ring-enova-light focus:border-enova-light focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-enova-dark">Month</label>
              <select
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 w-36 focus:ring-2 focus:ring-enova-light focus:border-enova-light focus:outline-none bg-white"
              >
                <option value="" disabled>Select Month</option>
                <option value="1">January</option>
                <option value="2">February</option>
                <option value="3">March</option>
                <option value="4">April</option>
                <option value="5">May</option>
                <option value="6">June</option>
                <option value="7">July</option>
                <option value="8">August</option>
                <option value="9">September</option>
                <option value="10">October</option>
                <option value="11">November</option>
                <option value="12">December</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-enova-dark">Manager Name</label>
              <input
                type="text"
                required
                placeholder="Lastname, Firstname"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 w-48 focus:ring-2 focus:ring-enova-light focus:border-enova-light focus:outline-none bg-white"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-enova-dark hover:bg-enova-light text-white font-medium px-6 py-2 rounded-md transition-colors duration-200 disabled:opacity-50 shadow-sm"
            >
              {loading && !data ? 'Loading...' : 'Generate Preview'}
            </button>
          </form>

          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-md mb-6 border border-red-200">
              {error}
            </div>
          )}

          {exportStatus === 'success' && (
            <div className="bg-green-50 text-green-700 p-4 rounded-md mb-6 border border-green-200">
              Successfully exported data to Google Sheets!
            </div>
          )}

          {data && data.length > 0 && (
            <div className="space-y-6">
              {unmatchedProjects.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-yellow-800 mb-2">
                    Unmatched Projects Detected
                  </h3>
                  <p className="text-xs text-yellow-700 mb-3">
                    The following projects could not be automatically matched to existing 'NC:' projects in the spreadsheet. 
                    Select any you'd like to append as new projects to the <strong>Projects</strong> tab.
                  </p>
                  <div className="flex flex-col gap-2">
                    {unmatchedProjects.map(proj => (
                      <div key={proj} className="flex flex-col md:flex-row md:items-center gap-3 bg-white px-3 py-2 rounded border border-yellow-100 hover:bg-yellow-50/50">
                        <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer flex-1">
                          <input 
                            type="checkbox" 
                            checked={selectedNewProjects.includes(proj)}
                            onChange={() => handleToggleNewProject(proj)}
                            className="rounded border-gray-300 text-enova-light focus:ring-enova-light mt-0.5"
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">{proj}</span>
                            <span className="text-gray-400 text-xs mt-0.5">Will be added as: NC: {proj}</span>
                          </div>
                        </label>
                        <div className="flex items-center gap-2">
                          {generatedBrds[proj] ? (
                            <a href={generatedBrds[proj]} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                              <span>📄 View BRD</span>
                            </a>
                          ) : (
                            <button
                              onClick={() => openBrdModal(proj)}
                              className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                            >
                              + Generate BRD
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-800">Preview ({data.length} rows)</h2>
                
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={handleExport}
                    disabled={loading || !isGoogleAuthed}
                    className={`font-medium px-6 py-2 rounded-md transition-colors flex items-center gap-2 ${
                      isGoogleAuthed 
                        ? 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-50' 
                        : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {loading && exportStatus === null ? 'Exporting...' : 'Export to Sheets'}
                  </button>
                  {!isGoogleAuthed && (
                    <span className="text-xs text-red-500">Please connect Google Sheets first</span>
                  )}
                </div>
              </div>
              
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-enova-dark text-white uppercase text-xs tracking-wider border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 min-w-[150px]">Person</th>
                      <th className="px-4 py-3 min-w-[200px]">Project (Fuzzy Matched)</th>
                      <th className="px-4 py-3">Design</th>
                      <th className="px-4 py-3">Dev</th>
                      <th className="px-4 py-3">QA</th>
                      <th className="px-4 py-3">Training</th>
                      <th className="px-4 py-3">Proj Mgmt</th>
                      <th className="px-4 py-3">Oversight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {data.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{row.Person}</span>
                          {row.OriginalPerson && row.OriginalPerson !== row.Person && (
                            <div className="text-xs text-gray-400 mt-1">Orig: {row.OriginalPerson}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={row.Project === 'No Epic' ? 'text-orange-500 italic' : ''}>
                            {row.Project}
                          </span>
                          {row.OriginalEpic && row.OriginalEpic !== row.Project && (
                            <div className="text-xs text-gray-400 mt-1">Orig: {row.OriginalEpic}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">{row.Design}</td>
                        <td className="px-4 py-3">{row.Development}</td>
                        <td className="px-4 py-3">{row.QA}</td>
                        <td className="px-4 py-3">{row.Training}</td>
                        <td className="px-4 py-3">{row.ProjectManagement}</td>
                        <td className="px-4 py-3">{row.ProjectOversight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                  onClick={handleExport}
                  disabled={loading || !isGoogleAuthed}
                  className={`font-medium px-6 py-2 rounded-md transition-colors flex items-center gap-2 ${
                    isGoogleAuthed 
                      ? 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-50' 
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {loading && exportStatus === null ? 'Exporting...' : 'Export to Sheets'}
                </button>
              </div>
            </div>
          )}

          {data && data.length === 0 && (
            <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              No completed issues found for this project and month.
            </div>
          )}
        </main>
      </div>

      {/* Sheet Picker Modal */}
      {isSheetPickerOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold text-gray-800">Select Target Spreadsheet</h2>
              <button onClick={() => setIsSheetPickerOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
              
              {/* Option 1: Paste URL */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-gray-700">Option 1: Paste URL or ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={manualSheetUrl}
                    onChange={(e) => setManualSheetUrl(e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 flex-1 text-sm focus:ring-2 focus:ring-enova-light focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => selectSheet(manualSheetUrl)}
                    disabled={!manualSheetUrl}
                    className="bg-enova-dark text-white hover:bg-enova-light px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Connect
                  </button>
                </div>
              </div>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-gray-200"></div>
                <span className="flex-shrink-0 mx-4 text-gray-400 text-sm">OR</span>
                <div className="flex-grow border-t border-gray-200"></div>
              </div>

              {/* Option 2: Recent Sheets */}
              <div className="flex flex-col gap-3">
                <label className="text-sm font-semibold text-gray-700">Option 2: Select a Recent Sheet</label>
                {!isGoogleAuthed ? (
                  <p className="text-sm text-red-500 bg-red-50 p-3 rounded border border-red-100">Please connect your Google Account first.</p>
                ) : loadingRecent ? (
                  <div className="py-8 text-center text-gray-500 animate-pulse">Loading recent files...</div>
                ) : recentSheets.length === 0 ? (
                  <div className="py-8 text-center text-gray-500 bg-gray-50 rounded border border-dashed border-gray-200">No recent spreadsheets found in your Drive.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recentSheets.map(file => (
                      <button
                        key={file.id}
                        onClick={() => selectSheet(file.id)}
                        className="flex items-center gap-3 text-left bg-white px-4 py-3 rounded-lg border border-gray-200 hover:border-green-400 hover:bg-green-50/30 transition-all duration-200"
                      >
                        <img src={file.iconLink} alt="Sheet" className="w-5 h-5 opacity-80" />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-medium text-gray-800 truncate">{file.name}</span>
                          <span className="text-xs text-gray-400">Edited {new Date(file.modifiedTime).toLocaleDateString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* BRD Generation Modal */}
      {brdModalProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Generate BRD Document</h2>
                <p className="text-sm text-gray-500">Project: {brdModalProject}</p>
              </div>
              <button onClick={closeBrdModal} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
              {brdMessage && (
                <div className={`p-3 rounded-md text-sm ${
                  brdMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                  brdMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                  'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {brdMessage.text}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-gray-700">1. Auto-Extract Data (Optional)</label>
                <p className="text-xs text-gray-500">
                  Paste URLs (Jira Epic, Google Docs) or raw text below. We will use AI to read them and auto-fill the variables.
                </p>
                <textarea
                  rows="3"
                  value={brdInputText}
                  onChange={(e) => setBrdInputText(e.target.value)}
                  placeholder="https://your-domain.atlassian.net/browse/PROJ-123&#10;https://docs.google.com/document/d/..."
                  className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-enova-light focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAutoExtract}
                    disabled={brdLoading || !brdInputText.trim()}
                    className="bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-200 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    ✨ Auto-Extract with AI
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-sm font-semibold text-gray-700">2. Template Variables</label>
                {brdVariables.length === 0 && !brdLoading && (
                  <p className="text-sm text-gray-500 italic">No variables `{'{{like_this}}'}` found in the template.</p>
                )}
                {brdVariables.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {brdVariables.map(v => (
                      <div key={v} className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600">{v}</label>
                        <input
                          type="text"
                          value={brdFormValues[v] || ''}
                          onChange={(e) => setBrdFormValues(prev => ({ ...prev, [v]: e.target.value }))}
                          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-enova-light focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
              <button
                type="button"
                onClick={closeBrdModal}
                className="px-4 py-2 text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateBrd}
                disabled={brdLoading}
                className="px-4 py-2 bg-enova-dark text-white rounded-md hover:bg-enova-light transition-colors text-sm font-medium disabled:opacity-50"
              >
                {brdLoading ? 'Processing...' : 'Create Document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
