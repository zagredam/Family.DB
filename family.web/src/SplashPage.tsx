import { useState, useRef } from 'react';
import './SplashPage.css';

type SplashPageProps = {
    onApiConnect: (url: string, tokenSecret: string) => Promise<void>;
    onSqliteLoad: (file: File) => void;
    onNewSqlite: (familyName: string) => void;
};

export function SplashPage({ onApiConnect, onSqliteLoad, onNewSqlite }: SplashPageProps) {
    const [apiUrl, setApiUrl] = useState('');
    const [accessKey, setAccessKey] = useState('');
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [showNewForm, setShowNewForm] = useState(false);
    const [newFamilyName, setNewFamilyName] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onSqliteLoad(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onSqliteLoad(file);
    };

    const handleConnect = async () => {
        if (!apiUrl.trim() || connecting) return;
        setConnecting(true);
        setConnectError(null);
        try {
            await onApiConnect(apiUrl, accessKey);
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            setConnectError(status === 401
                ? 'Login failed — invalid or expired access token.'
                : 'Could not reach the API server. Check the URL and try again.');
        } finally {
            setConnecting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleConnect();
    };

    const handleCreateNew = () => {
        const name = newFamilyName.trim();
        if (!name) return;
        onNewSqlite(name);
    };

    const handleNewKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleCreateNew();
        if (e.key === 'Escape') { setShowNewForm(false); setNewFamilyName(''); }
    };

    return (
        <div className="splash-container">
            <div className="splash-header">
                <h1 className="splash-title">Family Tree</h1>
                <p className="splash-subtitle">Choose how to load your family data</p>
            </div>
            <div className="splash-cards">
                <div className="splash-card">
                    <div className="card-icon">&#127760;</div>
                    <h2>Connect to API</h2>
                    <p>Connect to a running Family API server</p>
                    <input
                        type="text"
                        className="api-input"
                        value={apiUrl}
                        onChange={e => setApiUrl(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter API server URL"
                    />
                    <input
                        type="password"
                        className="api-input"
                        value={accessKey}
                        onChange={e => setAccessKey(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Access token"
                    />
                    {connectError && (
                        <p className="splash-connect-error">{connectError}</p>
                    )}
                    <button className="splash-btn primary" onClick={handleConnect} disabled={connecting || !apiUrl.trim()}>
                        {connecting ? 'Connecting…' : 'Connect'}
                    </button>
                </div>

                <div className="splash-divider">or</div>

                <div className="splash-card">
                    <div className="card-icon">&#128193;</div>
                    <h2>Upload SQLite File</h2>
                    <p>Open a local .sqlite database file to view and edit offline</p>
                    <div
                        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <span>Drop .sqlite file here or click to browse</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".sqlite,.db,.sqlite3"
                            style={{ display: 'none' }}
                            onChange={handleFileChange}
                        />
                    </div>

                    <div className="splash-new-divider">
                        <span>or start fresh</span>
                    </div>

                    {showNewForm ? (
                        <div className="splash-new-form">
                            <input
                                type="text"
                                className="api-input"
                                placeholder="Family name (e.g. Smith)"
                                value={newFamilyName}
                                onChange={e => setNewFamilyName(e.target.value)}
                                onKeyDown={handleNewKeyDown}
                                autoFocus
                            />
                            <div className="splash-new-actions">
                                <button
                                    className="splash-btn secondary"
                                    onClick={() => { setShowNewForm(false); setNewFamilyName(''); }}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="splash-btn primary"
                                    onClick={handleCreateNew}
                                    disabled={!newFamilyName.trim()}
                                >
                                    Create
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button className="splash-btn ghost" onClick={() => setShowNewForm(true)}>
                            + New File
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
