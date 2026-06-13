import { html } from 'htm/react';
import { useState, useEffect, useRef } from 'react';
import { SVG_Close, SVG_Moveable } from './icons/index';

export function Widget({ isOpen, onClose, title, id, children, ...props }: any) {
	if (!isOpen) {
		return null;
	}

	const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<any>(null);

  useEffect(() => {
    const handleMouseMove = (e: any) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.initialX + deltaX,
        y: dragRef.current.initialY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: any) => {
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
  };

	useEffect(() => {
		const onKeyDown = (event: any) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
		};
	}, []);

	return html`
		<div className="widget-body"
			id="${id}"
			style=${{ transform: `translate(${position.x}px, ${position.y}px)` }}>
			<div class="widget-container">
				<div class="widget-title-bar">
					<div class="widget-title"
						style=${{ cursor: isDragging ? 'grabbing' : 'grab' }}
						onMouseDown=${handleMouseDown}
						onMouseMove=${() => {}}
						onMouseUp=${() => {}}
						onMouseLeave=${() => {}}>
						<${SVG_Moveable}/>
						${title}
					</div>
					<button
						class="button-widget-top"
						onClick=${onClose}>
						<${SVG_Close}/>
					</button>
				</div>
				<div className="widget-content">
					${children}
				</div>
			</div>
		</div>`;
}
