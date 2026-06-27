export const defaultTemplates = {
	'Alpaca': {
		'sysPre' : '### System:\\n',
		'sysSuf' : '',
		'instPre': '\\n\\n### Instruction:\\n',
		'instSuf': '\\n\\n### Response:',
	},
	'Mistral': {
		'sysPre' : '<<SYS>>\\n',
		'sysSuf' : '<</SYS>>\\n\\n',
		'instPre': '</s>[INST]',
		'instSuf': '[/INST]',
	},
	'Codestral': {
		'sysPre' : '<<SYS>>\\n',
		'sysSuf' : '<</SYS>>\\n\\n',
		'instPre': '</s>[INST]',
		'instSuf': '[/INST]',
		'fimTemplate': '[SUFFIX]{suffix}[PREFIX]{prefix}'
	},
	"Dots1": {
		"sysPre": "<|system|>",
		"sysSuf": "<|endofsystem|>",
		"instPre": "<|userprompt|>",
		"instSuf": "<|endofuserprompt|><|response|>"
	},
	'ChatML': {
		'sysPre' : '<|im_start|>system\\n',
		'sysSuf' : '',
		'instPre': '<|im_end|>\\n<|im_start|>user\\n',
		'instSuf': '<|im_end|>\\n<|im_start|>assistant\\n',
	},
	'Llama 3': {
		'sysPre' : '<|start_header_id|>system<|end_header_id|>\\n\\n',
		'sysSuf' : '',
		'instPre': '<|eot_id|><|start_header_id|>user<|end_header_id|>\\n\\n',
		'instSuf': '<|eot_id|><|start_header_id|>assistant<|end_header_id|>\\n\\n',
	},
	'Phi 2': {
		'sysPre' : '',
		'sysSuf' : '',
		'instPre': '\\nInstruct: ',
		'instSuf': '\\nOutput: ',
	},
	'Phi 3': {
		'sysPre' : '<|system|>\\n',
		'sysSuf' : '',
		'instPre': '<|end|>\\n<|user|>\\n',
		'instSuf': '<|end|>\\n<|assistant|>\\n',
	},
	'Command-R': {
		'sysPre' : '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
		'sysSuf' : '',
		'instPre': '<|END_OF_TURN_TOKEN|><|START_OF_TURN_TOKEN|><|USER_TOKEN|>',
		'instSuf': '<|END_OF_TURN_TOKEN|><|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
	},
	'Metharme': {
		'sysPre' : '<|system|>',
		'sysSuf' : '',
		'instPre': '<|user|>',
		'instSuf': '<|model|>',
	},
	'Vicuna': {
		'sysPre' : '',
		'sysSuf' : '\\n\\n',
		'instPre': '</s>\\nUSER: ',
		'instSuf': '\\nASSISTANT: ',
	},
	'Gemma': {
		'sysPre' : '',
		'sysSuf' : '',
		'instPre': '<end_of_turn>\\n<start_of_turn>user\\n',
		'instSuf': '<end_of_turn>\\n<start_of_turn>model\\n',
	},
	'R1': { 
		'sysPre' : '', 
		'sysSuf' : '', 
		'instPre': '<｜User｜>', 
		'instSuf': '<｜Assistant｜><think>\n', 
	}, 
};
