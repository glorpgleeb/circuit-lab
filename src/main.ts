import './style.css';
import { mountShell } from './ui/shell';
import { solverPage } from './ui/solverPage';
import { equationsPage } from './ui/equationsPage';

mountShell(document.querySelector<HTMLElement>('#app')!, [equationsPage, solverPage]);
