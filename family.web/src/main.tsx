import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { ReactFlowProvider } from "@xyflow/react";
import TreeWrapper from "./TreeWrapper.js";
import { SplashPage } from "./SplashPage.js";
import { loadDatabase, loadDbFromLocalStorage, saveDbToLocalStorage, createNewDatabase } from "./SqliteService.js";
import { DataSource } from "./dataTypes.js";
import "@xyflow/react/dist/style.css";

type AppState =
    | { screen: 'splash' }
    | { screen: 'loading' }
    | { screen: 'tree'; dataSource: DataSource };

function App() {
    const [state, setState] = useState<AppState>({ screen: 'splash' });

    useEffect(() => {
        loadDbFromLocalStorage().then(db => {
            if (db) setState({ screen: 'tree', dataSource: { type: 'sqlite', db } });
        });
    }, []);

    const handleApiConnect = (url: string, accessKey: string) => {
        setState({ screen: 'tree', dataSource: { type: 'api', url, accessKey } });
    };

    const handleSqliteLoad = async (file: File) => {
        setState({ screen: 'loading' });
        try {
            const db = await loadDatabase(file);
            saveDbToLocalStorage(db);
            setState({ screen: 'tree', dataSource: { type: 'sqlite', db } });
        } catch {
            setState({ screen: 'splash' });
            alert('Failed to load SQLite file. Make sure it is a valid family tree database.');
        }
    };

    const handleNewSqlite = async (familyName: string) => {
        setState({ screen: 'loading' });
        const db = await createNewDatabase(familyName);
        saveDbToLocalStorage(db);
        setState({ screen: 'tree', dataSource: { type: 'sqlite', db } });
    };

    if (state.screen === 'splash') {
        return <SplashPage onApiConnect={handleApiConnect} onSqliteLoad={handleSqliteLoad} onNewSqlite={handleNewSqlite} />;
    }

    if (state.screen === 'loading') {
        return (
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #1a1f2e 0%, #2d3450 100%)',
                color: '#e8eaf6',
                fontSize: '1.2rem',
                fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>
                Loading database...
            </div>
        );
    }

    const handleBack = () => setState({ screen: 'splash' });

    return (
        <ReactFlowProvider>
            <TreeWrapper dataSource={state.dataSource} onBack={handleBack} />
        </ReactFlowProvider>
    );
}

declare global {
    interface Window {
        showTree: (element: HTMLElement) => void;
    }
}

window.showTree = (element: HTMLElement) => {
    ReactDOM.createRoot(element).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
};

window.showTree(document.getElementById("root")!);
