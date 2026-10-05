const paths={
 folder:'M3 7h6l2 2h10v10H3z M3 7V5h6l2 2h8v2',
 chevron:'m8 10 4 4 4-4',
 tree:'M5 4v14h5 M5 10h5 M11 7h8v5h-8z M11 15h8v5h-8z',
 list:'M9 5h11 M9 12h11 M9 19h11 M4 5h1 M4 12h1 M4 19h1',
 search:'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0 M16 16l5 5',
 refresh:'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 13-3l2 3 M4 16l2 3a8 8 0 0 0 13-3',
 plus:'M12 5v14 M5 12h14',
 code:'m8 6-6 6 6 6 M16 6l6 6-6 6 M14 4l-4 16',
 close:'m6 6 12 12 M6 18 18 6'
} as const;

/** Shared navigation icons retain their size across fonts and UI languages. */
export function WorkspaceIcon({name,className}:{name:keyof typeof paths;className?:string}){
 return <svg className={`workspace-icon ${className??''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}
