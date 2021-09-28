var Checker = require('../../../lib/checker');
var expect = require('chai').expect;

describe('rules/require-spaces-inside-parenthesized-expression', function() {
    var checker;
    beforeEach(function() {
        checker = new Checker();
        checker.registerDefaultRules();
    });

    describe('true', function() {
        beforeEach(function() {
            checker.configure({ requireSpacesInsideParenthesizedExpression: true });
        });

        it('should report required space after opening grouping parentheses', function() {
            expect(checker.checkString('(1 + 2 ) * 3'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
            expect(checker.checkString('if (1 + 2 )\n    3')).to.have.no.errors();
            expect(checker.checkString('function my(a, b ) {  }')).to.have.no.errors();
            expect(checker.checkString('my(a, b )')).to.have.no.errors();
        });

        it('should report required space before closing grouping parentheses', function() {
            expect(checker.checkString('( 1 + 2) * 3'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
            expect(checker.checkString('if ( 1 + 2)\n    3')).to.have.no.errors();
            expect(checker.checkString('function my( a, b) {  }')).to.have.no.errors();
            expect(checker.checkString('my( a, b)')).to.have.no.errors();
        });

        it('should report required space in both cases', function() {
            expect(checker.checkString('(1 + 2) * 3')).to.have.error.count.equal(2);
            expect(checker.checkString('if (1 + 2)\n    3')).to.have.no.errors();
            expect(checker.checkString('function my(a, b) {  }')).to.have.no.errors();
            expect(checker.checkString('my(a, b)')).to.have.no.errors();
            expect(checker.checkString('id = function(v) { return(v); }')).to.have.error.count.equal(2);
            expect(checker.checkString('(my(a), 1)')).to.have.error.count.equal(2);
            expect(checker.checkString('do {} while (false)')).to.have.no.errors();
            expect(checker.checkString('switch (a) { case(b): c }')).to.have.error.count.equal(2);
            expect(checker.checkString('(a)\n{ fn(); }')).to.have.error.count.equal(2);
        });

        it('should not report with spaces', function() {
            expect(checker.checkString('( 1 + 2 ) * 3')).to.have.no.errors();
            expect(checker.checkString('id = function(v) { return( v ); }')).to.have.no.errors();
            expect(checker.checkString('( my(a), 1 )')).to.have.no.errors();
            expect(checker.checkString('switch (a) { case( b ): c }')).to.have.no.errors();
            expect(checker.checkString('( a )\n{ fn(); }')).to.have.no.errors();
        });

        it('should not report with closing parentheses on new line', function() {
            expect(checker.checkString('(\n        0\n    )')).to.have.no.errors();
        });

        it('should report when a comment is after opening parentheses', function() {
            expect(checker.checkString('(/* comment */ el )'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
            expect(checker.checkString('(// comment\n el )'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
        });

        it('should report when a comment is before closing parentheses', function() {
            expect(checker.checkString('( i/* comment */)'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
        });

        it('should allow a comment with space', function() {
            expect(checker.checkString('( /* comment */ el /* comment */ )')).to.have.no.errors();
            expect(checker.checkString('( // comment\n el /* comment */ )')).to.have.no.errors();
        });

        it('should report nested parentheses', function() {
            expect(checker.checkString('((1, 2))')).to.have.error.count.equal(4);
            expect(checker.checkString('if ((1 + 2))\n    3')).to.have.error.count.equal(2);
            expect(checker.checkString('(my)((a),(b))')).to.have.error.count.equal(6);
        });

        it('should not report with nested spaces', function() {
            expect(checker.checkString('( ( 1, 2 ) )')).to.have.no.errors();
            expect(checker.checkString('if (( 1 + 2 ))\n    3')).to.have.no.errors();
            expect(checker.checkString('( my )(( a ),( b ))')).to.have.no.errors();
        });
    });

    describe('exceptions', function() {
        it('should not report for function or object when so configured', function() {
            checker.configure({
                requireSpacesInsideParenthesizedExpression: {
                    allExcept: ['{', '}', 'function']
                }
            });

            expect(checker.checkString('([])')).to.have.error.count.equal(2);
            expect(checker.checkString('("string")')).to.have.error.count.equal(2);
            expect(checker.checkString('(i)')).to.have.error.count.equal(2);
            expect(checker.checkString('(1)')).to.have.error.count.equal(2);
            expect(checker.checkString('(function() {}, {})')).to.have.no.errors();
        });

        it('should not report for object when so configured', function() {
            checker.configure({
                requireSpacesInsideParenthesizedExpression: {
                    allExcept: ['{', '}']
                }
            });

            expect(checker.checkString('([])')).to.have.error.count.equal(2);
            expect(checker.checkString('("string")')).to.have.error.count.equal(2);
            expect(checker.checkString('(i)')).to.have.error.count.equal(2);
            expect(checker.checkString('(1)')).to.have.error.count.equal(2);
            expect(checker.checkString('(function() {}, {})'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
            expect(checker.checkString('( function() {}, {})')).to.have.no.errors();
        });

        it('should consider comments', function() {
            checker.configure({
                requireSpacesInsideParenthesizedExpression: {
                    allExcept: ['//', '/*', '*/']
                }
            });

            expect(checker.checkString('(foo)')).to.have.error.count.equal(2);
            expect(checker.checkString('(/**/ foo /**/)')).to.have.no.errors();
            expect(checker.checkString('(//\n foo //\n)')).to.have.no.errors();
            expect(checker.checkString('(/*comment*/ foo /*comment*/)')).to.have.no.errors();
            expect(checker.checkString('(//comment\n foo //comment\n)')).to.have.no.errors();
        });

        it('should differentiate comments', function() {
            checker.configure({
                requireSpacesInsideParenthesizedExpression: {
                    allExcept: ['/*', '*/']
                }
            });

            expect(checker.checkString('(foo)')).to.have.error.count.equal(2);
            expect(checker.checkString('(/**/ foo /**/)')).to.have.no.errors();
            expect(checker.checkString('(//\n foo //\n)'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
            expect(checker.checkString('(/*comment*/ foo /*comment*/)')).to.have.no.errors();
            expect(checker.checkString('(//comment\n foo //comment\n)'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
        });

        it('should not look inside comments', function() {
            checker.configure({
                requireSpacesInsideParenthesizedExpression: {
                    allExcept: ['[', ']']
                }
            });

            expect(checker.checkString('([ foo ])')).to.have.no.errors();
            expect(checker.checkString('(/*[*/ foo /*]*/)')).to.have.error.count.equal(2);
            expect(checker.checkString('(//[\n foo )'))
              .to.have.one.validation.error.from('requireSpacesInsideParenthesizedExpression');
        });
    });

    describe('invalid configuration', function() {
        it('should not accept objects without at least one valid key', function() {
            expect(function() {
                    checker.configure({ requireSpacesInsideParenthesizedExpression: {} });
                }).to.throw('AssertionError');
        });

        it('should not accept non-boolean non-objects', function() {
            expect(function() {
                    checker.configure({ requireSpacesInsideParenthesizedExpression: 'true' });
                }).to.throw('AssertionError');
        });
    });
});
