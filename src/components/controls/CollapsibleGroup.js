import { html } from 'htm/react';
import { useState, useEffect, useRef } from 'react';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { SVG_ArrowUp } from '../icons/index.js';

const SVResizeObserver = typeof ResizeObserver !== 'undefined' ? ResizeObserver : class { observe() {} disconnect() {} };

export function CollapsibleGroup({ label, stateLabel, menu, expanded, children }) {
	const contentArea = useRef(null);
	const menuRef = useRef(null);
	const [isCollapsed, setIsCollapsed] = usePersistentState(`(${stateLabel ? stateLabel : label}).isCollapsed`, !expanded);
	const [contentHeight, setContentHeight] = useState(isCollapsed ? 0 : '');
	const [isMenuVisible, setIsMenuVisible] = useState(false);

	const isAnimating = useRef(false);

	useEffect(() => {
		if (!contentArea.current) return;
		const observer = new SVResizeObserver(() => {
			// Only update if expanded and NOT in the middle of a manual animation/toggle
			if (!isCollapsed && !isAnimating.current && contentHeight !== 'none') {
				setContentHeight(contentArea.current.scrollHeight);
			}
		});
		observer.observe(contentArea.current);
		return () => observer.disconnect();
	}, [isCollapsed, contentHeight]);

	// Close the menu when clicking outside of it
	useEffect(() => {
		if (!menu || !isMenuVisible)
			return;
		const handleClickOutside = (e) => {
			if (menuRef.current && !menuRef.current.contains(e.target)) {
				setTimeout(() => {
					setIsMenuVisible(false);
				}, 150);
			}
		}
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [menu, isMenuVisible]);

	const toggle = () => {
		if (isCollapsed) {
			// Opening: set to scrollHeight first
			isAnimating.current = true;
			setContentHeight(contentArea.current.scrollHeight);
			setIsCollapsed(false);
			// After animation, set to none to allow dynamic growth (nested groups)
			setTimeout(() => {
				setContentHeight('none');
				isAnimating.current = false;
			}, 200);
		} else {
			// Closing: must set to scrollHeight from 'none' first to animate
			isAnimating.current = true;
			const currentHeight = contentArea.current.scrollHeight;
			setContentHeight(currentHeight);
			// Force reflow to ensure the browser registers the pixel height before we set it to 0
			void contentArea.current.offsetHeight;
			
			// Use requestAnimationFrame to ensure the next state change happens after reflow
			requestAnimationFrame(() => {
				setIsCollapsed(true);
				setContentHeight(0);
				setTimeout(() => {
					isAnimating.current = false;
				}, 200);
			});
		}
	};

	return html`
		<div className="collapsible-group" style=${{position: 'relative'}}>
			<div className="collapsible-header" onClick=${toggle}>
				<${SVG_ArrowUp} style=${{ 'transform': isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)', 'transition': 'transform 0.15s ease-in-out' }}/>
				${label}
				<div class="flex-separator"></div>
				${menu && html`
					<button style=${{ 'padding': '0px 7px'}} onClick=${(e) => (setIsMenuVisible(!isMenuVisible), e.stopPropagation())}>
						⋮
					</button>
					${isMenuVisible && html`
						<div ref=${menuRef} className="floating-menu" onClick=${(e) => e.stopPropagation()}>
							${menu}
						</div>`}
					`}
			</div>
			<div
				ref=${contentArea}
				className="collapsible-content ${isCollapsed ? 'collapsed' : 'expanded'}"
				style=${{ 'max-height': contentHeight === 'none' ? 'none' : (contentHeight + 'px') }}>
				${children}
			</div>
		</div>`;
}
