import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTechTerms, isTechnicalTermQuery } from '../src/modules/voice/techTermNormalizer.js';

test('TechTermNormalizer - canonicalizes MERN Stack and its exact variations', () => {
  assert.equal(normalizeTechTerms('MERN Stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('mern stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('mernstack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('m.e.r.n. stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('m e r n stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('m-e-r-n stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('mern'), 'MERN');
  assert.equal(normalizeTechTerms('m.e.r.n.'), 'MERN');
  assert.equal(normalizeTechTerms('m e r n'), 'MERN');
});

test('TechTermNormalizer - handles Indian accent acoustic variations of MERN Stack', () => {
  // Common Whisper misrecognitions of Indian accents for MERN Stack
  assert.equal(normalizeTechTerms('man stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('men stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('marne stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('marn stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('learn stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('burn stack'), 'MERN Stack');
  assert.equal(normalizeTechTerms('mare in stack'), 'MERN Stack');

  // Inside full conversational sentences
  assert.equal(normalizeTechTerms('Can you explain man stack?'), 'Can you explain MERN Stack?');
  assert.equal(normalizeTechTerms('What are the advantages of men stack?'), 'What are the advantages of MERN Stack?');
  assert.equal(normalizeTechTerms('I want to build a project using marne stack'), 'I want to build a project using MERN Stack');
});

test('TechTermNormalizer - normalizes MongoDB and Indian accent variations', () => {
  assert.equal(normalizeTechTerms('mongodb'), 'MongoDB');
  assert.equal(normalizeTechTerms('mongo db'), 'MongoDB');
  assert.equal(normalizeTechTerms('mango db'), 'MongoDB');
  assert.equal(normalizeTechTerms('mongo database'), 'MongoDB');
  assert.equal(normalizeTechTerms('mango database'), 'MongoDB');
  assert.equal(normalizeTechTerms('How do I connect mango db with Node?'), 'How do I connect MongoDB with Node?');
});

test('TechTermNormalizer - normalizes Express.js variations', () => {
  assert.equal(normalizeTechTerms('express js'), 'Express.js');
  assert.equal(normalizeTechTerms('expressjs'), 'Express.js');
  assert.equal(normalizeTechTerms('express.js'), 'Express.js');
  assert.equal(normalizeTechTerms('express j s'), 'Express.js');
  assert.equal(normalizeTechTerms('Build a server with express js'), 'Build a server with Express.js');
});

test('TechTermNormalizer - normalizes React.js and React Native', () => {
  assert.equal(normalizeTechTerms('react js'), 'React.js');
  assert.equal(normalizeTechTerms('reactjs'), 'React.js');
  assert.equal(normalizeTechTerms('react.js'), 'React.js');
  assert.equal(normalizeTechTerms('react j s'), 'React.js');
  assert.equal(normalizeTechTerms('react native'), 'React Native');
  assert.equal(normalizeTechTerms('What are hooks in react js?'), 'What are hooks in React.js?');
});

test('TechTermNormalizer - normalizes Node.js and Indian accent variations', () => {
  assert.equal(normalizeTechTerms('node js'), 'Node.js');
  assert.equal(normalizeTechTerms('nodejs'), 'Node.js');
  assert.equal(normalizeTechTerms('node.js'), 'Node.js');
  assert.equal(normalizeTechTerms('know js'), 'Node.js');
  assert.equal(normalizeTechTerms('note js'), 'Node.js');
  assert.equal(normalizeTechTerms('How does note js handle asynchronous I/O?'), 'How does Node.js handle asynchronous I/O?');
});

test('TechTermNormalizer - normalizes JavaScript and TypeScript', () => {
  assert.equal(normalizeTechTerms('java script'), 'JavaScript');
  assert.equal(normalizeTechTerms('javascript'), 'JavaScript');
  assert.equal(normalizeTechTerms('type script'), 'TypeScript');
  assert.equal(normalizeTechTerms('typescript'), 'TypeScript');
  assert.equal(normalizeTechTerms('Why use type script over java script?'), 'Why use TypeScript over JavaScript?');
});

test('TechTermNormalizer - normalizes API and REST API variations', () => {
  assert.equal(normalizeTechTerms('a p i'), 'API');
  assert.equal(normalizeTechTerms('a.p.i.'), 'API');
  assert.equal(normalizeTechTerms('rest api'), 'REST API');
  assert.equal(normalizeTechTerms('rest a p i'), 'REST API');
  assert.equal(normalizeTechTerms('restapi'), 'REST API');
  assert.equal(normalizeTechTerms('restful api'), 'RESTful API');
  assert.equal(normalizeTechTerms('Design a rest a p i for users'), 'Design a REST API for users');
});

test('TechTermNormalizer - normalizes developer ecosystem and architectures', () => {
  assert.equal(normalizeTechTerms('mean stack'), 'MEAN Stack');
  assert.equal(normalizeTechTerms('lamp stack'), 'LAMP Stack');
  assert.equal(normalizeTechTerms('next js'), 'Next.js');
  assert.equal(normalizeTechTerms('vue js'), 'Vue.js');
  assert.equal(normalizeTechTerms('graph ql'), 'GraphQL');
  assert.equal(normalizeTechTerms('postgre sql'), 'PostgreSQL');
  assert.equal(normalizeTechTerms('no sql'), 'NoSQL');
  assert.equal(normalizeTechTerms('git hub'), 'GitHub');
  assert.equal(normalizeTechTerms('n p m'), 'npm');
  assert.equal(normalizeTechTerms('full steak developer'), 'full-stack developer');
  assert.equal(normalizeTechTerms('front end and back end'), 'frontend and backend');
});

test('TechTermNormalizer - normalizes Devanagari tech terms in Marathi and Hindi', () => {
  assert.equal(normalizeTechTerms('मर्न स्टॅक म्हणजे काय?'), 'MERN Stack म्हणजे काय?');
  assert.equal(normalizeTechTerms('मर्न स्टैक क्या है?'), 'MERN Stack क्या है?');
  assert.equal(normalizeTechTerms('मोंगो डीबी बद्दल माहिती सांगा'), 'MongoDB बद्दल माहिती सांगा');
  assert.equal(normalizeTechTerms('मोंगो डीबी के बारे में बताओ'), 'MongoDB के बारे में बताओ');
  assert.equal(normalizeTechTerms('एक्सप्रेस जेएस वापरा'), 'Express.js वापरा');
  assert.equal(normalizeTechTerms('रिएक्ट जेएस शिका'), 'React.js शिका');
  assert.equal(normalizeTechTerms('नोड जेएस सर्वर'), 'Node.js सर्वर');
  assert.equal(normalizeTechTerms('जावास्क्रिप्ट आणि टाइपस्क्रिप्ट'), 'JavaScript आणि TypeScript');
  assert.equal(normalizeTechTerms('रेस्ट एपीआई बनवा'), 'REST API बनवा');
  assert.equal(normalizeTechTerms('एपीआई कॉल करा'), 'API कॉल करा');
});

test('TechTermNormalizer - correctly identifies technical term queries', () => {
  assert.equal(isTechnicalTermQuery('MERN Stack'), true);
  assert.equal(isTechnicalTermQuery('mern'), true);
  assert.equal(isTechnicalTermQuery('Tell me about mongodb'), true);
  assert.equal(isTechnicalTermQuery('How does react.js work?'), true);
  assert.equal(isTechnicalTermQuery('मर्न स्टॅक म्हणजे काय?'), true);
  assert.equal(isTechnicalTermQuery('रिएक्ट जेएस क्या है?'), true);
  assert.equal(isTechnicalTermQuery('मोंगो डीबी माहिती'), true);
  assert.equal(isTechnicalTermQuery('Good morning, how are you today?'), false);
  assert.equal(isTechnicalTermQuery('शुभ सकाळ, कसे आहात?'), false);
  assert.equal(isTechnicalTermQuery('नमस्ते, आप कैसे हैं?'), false);
  assert.equal(isTechnicalTermQuery(''), false);
  assert.equal(isTechnicalTermQuery(null), false);
});

