import { html } from 'htm/react';

export const SVG = ({ 
	stroke="currentColor",
	fill="currentColor",
	strokeWidth="0",
	children,
	...props
}) => {
	return html`
	<svg
		xmlns="http://www.w3.org/2000/svg"
		fill=${fill}
		stroke=${stroke}
		strokeWidth=${strokeWidth}
		...${props}
	>
		${children}
	</svg>
`};
export const SVG_Close = ({...props}) => {
	return html`
	<${SVG}
		viewBox="-1 -1 10 10">
		<path d="M 0 1 L 3 4 L 0 7 L 1 8 L 4 5 L 7 8 L 8 7 L 5 4 L 8 1 L 7 0 L 4 3 L 1 0 L 1 0 Z"/>
	</${SVG}>
`};
export const SVG_Confirm = ({...props}) => {
	return html`
	<${SVG}
		width="16"
		height="16"
		viewBox="0 0 128 128">
		<circle cx="64" cy="64" r="64" fill="var(--color-dark)"/>
		<path d="M54.3 97.2 24.8 67.7c-.4-.4-.4-1 0-1.4l8.5-8.5c.4-.4 1-.4 1.4 0L55 78.1l38.2-38.2c.4-.4 1-.4 1.4 0l8.5 8.5c.4.4.4 1 0 1.4L55.7 97.2c-.4.4-1 .4-1.4 0z"/>
	</${SVG}>
`};
export const SVG_Cancel = ({...props}) => {
	return html`
	<${SVG}
		width="16"
		height="16"
		viewBox="0 0 128 128">
		<circle cx="64" cy="64" r="64" fill="var(--color-dark)"/>
		<path d="M100.3 90.4 73.9 64l26.3-26.4c.4-.4.4-1 0-1.4l-8.5-8.5c-.4-.4-1-.4-1.4 0L64 54.1 37.7 27.8c-.4-.4-1-.4-1.4 0l-8.5 8.5c-.4.4-.4 1 0 1.4L54 64 27.7 90.3c-.4.4-.4 1 0 1.4l8.5 8.5c.4.4 1.1.4 1.4 0L64 73.9l26.3 26.3c.4.4 1.1.4 1.5.1l8.5-8.5c.4-.4.4-1 0-1.4z"/>
	</${SVG}>
`};
export const SVG_Trash = ({...props}) => {
	return html`
	<${SVG}
		width="16"
		height="16"
		viewBox="0 0 490.646 490.646">
		<path d="m399.179 67.285-74.794.033L324.356 0 166.214.066l.029 67.318-74.802.033.025 62.914h307.739l-.026-63.046zM198.28 32.11l94.03-.041.017 35.262-94.03.041-.017-35.262zM91.465 490.646h307.739V146.359H91.465v344.287zm225.996-297.274h16.028v250.259h-16.028V193.372zm-80.14 0h16.028v250.259h-16.028V193.372zm-80.141 0h16.028v250.259H157.18V193.372z"/>
	</${SVG}>
`};
export const SVG_Rename = ({...props}) => {
	return html`
	<${SVG}
		width="16"
		height="16"
		viewBox="0 0 512 448">
		<path style=${{ strokeLinecap: 'round', strokeMiterlimit: 4 }} d="M0 96v256h320v-32H32V128h288V96H0zM416 96v32h64v192h-64v32h96V96h-96z" />
		<path style=${{ strokeLinecap: 'round', strokeMiterlimit: 4 }} d="M352 636.362h32v384h-32z" transform="matrix(1, 0, 0, 1, 0, -604.3619995117188)" />
		<path style=${{ strokeLinecap: 'round', strokeMiterlimit: 4 }} transform="matrix(0, 1, -1, 0, 0, -604.3619995117188)" d="M1020.362-448h32v64h-32zM1020.362-352h32v64h-32zM604.362-448h32v64h-32zM604.362-352h32v64h-32zM764.362-288h128v224h-128z" />
	</${SVG}>
`};
export const SVG_ArrowUp = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 0 330 330"
		width="12"
		height="12">
		<path d="M325.606,229.393l-150.004-150C172.79,76.58,168.974,75,164.996,75c-3.979,0-7.794,1.581-10.607,4.394 l-149.996,150c-5.858,5.858-5.858,15.355,0,21.213c5.857,5.857,15.355,5.858,21.213,0l139.39-139.393l139.397,139.393 C307.322,253.536,311.161,255,315,255c3.839,0,7.678-1.464,10.607-4.394C331.464,244.748,331.464,235.251,325.606,229.393z"/>
	</${SVG}>
`};
export const SVG_ArrowDown = ({...props}) => {
	return html`
	<${SVG_ArrowUp}
		...${props}
		style=${{ 'transform':'rotate(180deg)' }}/>
`};
export const SVG_Settings = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="-1 -5 8 7">
		<path d="M0 0 3-3C3-4 3-5 5-5L4-4 5-3 6-4C6-2 5-2 4-2L1 1C0 2-1 1 0 0"/>
	</${SVG}>
`};
export const SVG_MobileSidebar = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		transform="translate(0, 2)"
		width="16"
		height="16"
		viewBox="0 0 512 512">
		<path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/>
	</${SVG}>
`};
export const SVG_ShowKey = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		width="16"
		height="16"
		viewBox="0 0 24 24">
		<path d="M15 12c0 1.654-1.346 3-3 3s-3-1.346-3-3 1.346-3 3-3 3 1.346 3 3zm9-.449s-4.252 8.449-11.985 8.449c-7.18 0-12.015-8.449-12.015-8.449s4.446-7.551 12.015-7.551c7.694 0 11.985 7.551 11.985 7.551zm-7 .449c0-2.757-2.243-5-5-5s-5 2.243-5 5 2.243 5 5 5 5-2.243 5-5z"/>
	</${SVG}>
`};
export const SVG_HideKey = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		width="16"
		height="16"
		viewBox="0 0 24 24">
		<path d="M11.885 14.988l3.104-3.098.011.11c0 1.654-1.346 3-3 3l-.115-.012zm8.048-8.032l-3.274 3.268c.212.554.341 1.149.341 1.776 0 2.757-2.243 5-5 5-.631 0-1.229-.13-1.785-.344l-2.377 2.372c1.276.588 2.671.972 4.177.972 7.733 0 11.985-8.449 11.985-8.449s-1.415-2.478-4.067-4.595zm1.431-3.536l-18.619 18.58-1.382-1.422 3.455-3.447c-3.022-2.45-4.818-5.58-4.818-5.58s4.446-7.551 12.015-7.551c1.825 0 3.456.426 4.886 1.075l3.081-3.075 1.382 1.42zm-13.751 10.922l1.519-1.515c-.077-.264-.132-.538-.132-.827 0-1.654 1.346-3 3-3 .291 0 .567.055.833.134l1.518-1.515c-.704-.382-1.496-.619-2.351-.619-2.757 0-5 2.243-5 5 0 .852.235 1.641.613 2.342z"/>
	</${SVG}>
`};
export const SVG_SysPrompt = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 -10 10 10">
		<path d="M 0 -2 L 1 -1 L 5 -5 L 1 -9 L 0 -8 L 3 -5 L 0 -2 M 4 -1 L 10 -1 L 10 -2.4 L 4 -2.4"/>
	</${SVG}>
`};
export const SVG_instTemplate = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 -10 5 10">
		<path d="M 2.5 -6 A 0.75 0.75 90 0 0 3.25 -6.75 A 0.75 0.75 90 0 0 2.5 -7.5 A 0.75 0.75 90 0 0 1.75 -6.75 A 0.75 0.75 90 0 0 2.5 -6 M 1 0 L 4 0 L 4 -1 L 3 -1 L 3 -5 L 1 -5 L 1 -4 L 2 -4 L 2 -1 L 1 -1 Z"/>
	</${SVG}>
`};
export const SVG_ChatMode = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 0 10 10">
		<path d="M 2 10 L 2 7 Q 0 7 0 5 L 0 2 Q 0 0 2 0 L 8 0 Q 10 0 10 2 Q 10 2 10 3 L 10 5 Q 10 7 8 7 L 6 7 Z"/>
	</${SVG}>
`};
export const SVG_CompletionMode = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="2 -1 34 28">
		<path d="M 3 25 L 3 4 C 9 1 15 2 18 6 C 21 2 27 1 33 4 L 33 25 C 27 22 21 23 18 26 C 15 23 9 22 3 25 Z"/>
	</${SVG}>
`};
export const SVG_Regen = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 0 40.499 40.5"
		width="12"
		height="12">
		<path d="M39.622,21.746l-6.749,6.75c-0.562,0.562-1.326,0.879-2.122,0.879s-1.56-0.316-2.121-0.879l-6.75-6.75		c-1.171-1.171-1.171-3.071,0-4.242c1.171-1.172,3.071-1.172,4.242,0l1.832,1.832C27.486,13.697,22.758,9.25,17,9.25		c-6.064,0-11,4.935-11,11c0,6.064,4.936,11,11,11c1.657,0,3,1.343,3,3s-1.343,3-3,3c-9.373,0-17-7.626-17-17s7.627-17,17-17		c8.936,0,16.266,6.933,16.936,15.698l1.442-1.444c1.172-1.172,3.072-1.172,4.242,0C40.792,18.674,40.792,20.574,39.622,21.746z"/>
	</${SVG}>
`};
export const SVG_Undo = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 0 24 24"
		width="12"
		height="12">
		<path d="M17.026 22.957c10.957-11.421-2.326-20.865-10.384-13.309l2.464 2.352h-9.106v-8.947l2.232 2.229c14.794-13.203 31.51 7.051 14.794 17.675z"/>
	</${SVG}>
`};
export const SVG_Redo = ({...props}) => {
	return html`
	<${SVG_Undo}
		...${props}
		style=${{ 'transform':'scaleX(-1)' }}/>
`};
export const SVG_Star = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		width="14"
		height="14"
		viewBox="0 0 24 24">
		<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
	</${SVG}>
`};
export const SVG_StarOutline = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		width="14"
		height="14"
		viewBox="0 0 24 24">
		<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2zm0 2.89l-2.09 4.23-4.68.68 3.39 3.3-.8 4.67L12 15.85l4.18 2.2-.8-4.67 3.39-3.3-4.68-.68L12 4.89z"/>
	</${SVG}>
`};
export const SVG_SearchAndReplace = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 0 29.4 35.4"
		stroke-linecap="round"
		stroke-width="5">
		<path fill="none" stroke-linejoin="round" d="M5 9.1a10.6 10.6 0 0 1 9.7-6.6 10.6 10.6 0 0 1 9.8 6.6m0 7.9a10.6 10.6 0 0 1-9.8 6.7A10.6 10.6 0 0 1 5 17"/>
		<path fill="none" d="m20.4 24.5 3.6 7.1"/>
		<path stroke="none" d="M3.6 13.2 0 23.2l13.6-6.4-10-3.6m22.2-.2 3.6-10L16 9.3l10 3.6"/>
	</${SVG}>
`};
export const SVG_Moveable = ({...props}) => {
	return html`
	<${SVG}
		...${props}
		viewBox="0 0 11 11">
		<path d="M 5.5 11 L 7 9 L 6 9 L 6 6 L 9 6 L 9 7 L 11 5.5 L 9 4 L 9 5 L 6 5 L 6 2 L 7 2 L 5.5 0 L 4 2 L 5 2 L 5 5 L 2 5 L 2 4 L 0 5.5 L 2 7 L 2 6 L 5 6 L 5 9 L 4 9 Z"/>
	</${SVG}>
`};
export const SVG_Stop = ({ ...props }) => {
		return html`
	<${SVG}
		...${props}
		viewBox="0 0 24 24">
		<path fill="var(--color-light)" fillRule="evenodd" d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4z"/>
	</${SVG}>
`};
export const SVG_Camera = ({ ...props }) => {
  return html`
    <${SVG}
      ...${props}
      viewBox="0 0 16 16"
      fill="currentColor">
      <path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/>
      <path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/>
    </${SVG}>
  `;
};

export const SVG_SplitView = ({ ...props }) => {
  return html`
    <${SVG}
      ...${props}
      viewBox="0 0 16 16"
      fill="currentColor"
      style=${{height:"1.3em"}}>
      <path d="M8 3.5a.5.5 0 0 0-1 0V14a.5.5 0 0 0 1 0V3.5z"/>
      <path d="M1.5 3a.5.5 0 0 1 .5-.5h5.5a1.5 1.5 0 0 1 1.5 1.5v10a.5.5 0 0 1-.5.5H2a1.5 1.5 0 0 1-1.5-1.5V3zm1 .5v9a.5.5 0 0 0 .5.5h5V4a.5.5 0 0 0-.5-.5H2.5z"/>
      <path d="M14.5 3a.5.5 0 0 0-.5-.5H8.5A1.5 1.5 0 0 0 7 4v10a.5.5 0 0 0 .5.5H14a1.5 1.5 0 0 0 1.5-1.5V3zm-1 .5v9a.5.5 0 0 1-.5.5H8V4a.5.5 0 0 1 .5-.5h5z"/>
      <path d="M3 5h3v1H3V5zm0 2h3v1H3V7zm7-2h3v1h-3V5zm0 2h3v1h-3V7z" opacity="0.6"/>
    </${SVG}>
  `;
};
