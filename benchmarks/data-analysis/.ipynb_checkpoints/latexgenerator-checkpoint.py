from pylatex import UnsafeCommand

class LatexExporter:
    def __init__(self):
        self.commands = []

    def add_command(self, name, value):
        return self.commands.append(UnsafeCommand('newcommand', '\\%s' % name, options=None, extra_arguments=r'%s' % value))

    def export_commands(self, filepath):
        with open(filepath, 'w', encoding='utf-8') as newf:
            for c in self.commands:
                newf.write(c.dumps())
                newf.write('\n')

# exporter = LatexExporter()
# exporter.add_command('test', 'value')
# exporter.add_command('test2', 'value2')
# exporter.generate_tex('result-generated.tex')