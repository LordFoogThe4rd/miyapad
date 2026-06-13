import { html } from 'htm/react';
import { Modal } from '../Modal';
import { API_OPENAI_COMPAT, API_DEEPSEEK } from '../../constants';

export function GrammarModal({ isOpen, closeModal, grammar, setGrammar, endpointAPI, cancel }: any) {
	const grammarExample = `# "root" specifies the pattern for the overall output
root ::= (
    # it must start with the characters "1. " followed by a sequence
    # of characters that match the "move" rule, followed by a space, followed
    # by another move, and then a newline
    "1. " move " " move "\\n"

    # it's followed by one or more subsequent moves, numbered with one or two digits
    ([1-9] [0-9]? ". " move " " move "\\n")+
)

# "move" is an abstract representation, which can be a pawn, nonpawn, or castle.
# The "[+#]?" denotes the possibility of checking or mate signs after moves
move ::= (pawn | nonpawn | castle) [+#]?

pawn ::= ...
nonpawn ::= ...
castle ::= ...`;
	const grammarHelpUrl = html`<a href="https://github.com/ggerganov/llama.cpp/blob/master/grammars/README.md">llama.cpp/grammars/README.md</a>`;

	const grammarEBNFExample = `root      ::= (commands eol)+
commands  ::= t | info | nav
nav       ::= "nav(\\"/" [a-z/]*  "\\")"
info      ::= "info(" setting ")"
t         ::= "t(" setting ": " value ")"
value     ::= color | number | string | boolean
color     ::= "#" [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]
setting   ::= [a-z_ ]+
string    ::= "\\"" [ \\t!#-\\[\\]-~#x80-#xFF]* "\\""
number    ::= [0-9]+
boolean   ::= ("true" | "false")
eol       ::= "\\n"`;
	const grammarEBNFHelpUrl = html`<a href="https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form">wiki/Extended_Backus–Naur_form</a>`;

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Grammar"
			description=${html`<div>Grammar is a set of rules to generate predictions. Each rule has a name and defines how to create specific text patterns.</div><br/><div>For more information see: ${endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK ? grammarEBNFHelpUrl : grammarHelpUrl}</div>`}>
			<textarea
				readOnly=${!!cancel}
				value=${grammar}
				placeholder=${endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK ? grammarEBNFExample : grammarExample}
				onInput=${(e: any) => setGrammar(e.target.value)}
				class="expanded-text-area-settings"/>
		</${Modal}>`;
}
